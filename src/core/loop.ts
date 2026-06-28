import type { LLMProvider, Message, ToolCall } from "../types/llm"
import type { AgentContext, ToolResult } from "../types/rooms"
import type { AgentState } from "../agents/state"
import { BudgetTracker, type BudgetConfig } from "./budget"
import {
  buildSystemPrompt,
  buildWakeUpMessage,
  buildNotificationMessage,
  type WakeUpContext,
  type TurnNotifications,
} from "./context"
import { shouldCompact, compactMessages } from "./compaction"
import { decayToolResults } from "./decay"
import {
  withSessionTrace,
  withTurnSpan,
  withToolSpan,
  type SessionTraceHandle,
  type TurnSpanHandle,
} from "../observability/traced-provider"

/**
 * Configuration for running a session.
 */
export interface SessionConfig {
  sessionNumber: number
  budget: BudgetConfig
  reflections: string[] // Relevant past reflections
  inboxCount: number
  previousSessionSummary: string | null // Summary of the previous session
}

/**
 * Result of running a session.
 */
export interface SessionResult {
  sessionNumber: number
  endReason: "sleep" | "budget_exhausted"
  totalTokensUsed: number
  totalCost: number
  turns: TurnRecord[]
  sessionSummary: string | null // Summary of this session for the next one
}

/**
 * Record of a single turn.
 */
export interface TurnRecord {
  sequence: number
  room: string
  inputTokens: number
  outputTokens: number
  cost?: number
  assistantMessage: string | null
  toolCalls: ToolCall[]
  toolResults: { name: string; result: ToolResult }[]
}

/**
 * Runs a single session in the agent's life.
 * @param llm - The LLM provider to use
 * @param config - Session configuration
 * @param agentState - Per-agent state (stores, workspace, registry)
 */
export async function runSession(
  llm: LLMProvider,
  config: SessionConfig,
  agentState: AgentState
): Promise<SessionResult> {
  // Wrap the whole session in a Langfuse trace; every llm.send() below nests
  // under it as a generation. No-op when tracing is disabled.
  return withSessionTrace(
    { agentId: agentState.agentId, sessionNumber: config.sessionNumber },
    (trace) => runSessionInner(llm, config, agentState, trace)
  )
}

async function runSessionInner(
  llm: LLMProvider,
  config: SessionConfig,
  agentState: AgentState,
  trace: SessionTraceHandle
): Promise<SessionResult> {
  const { stores, roomRegistry: registry } = agentState
  const budget = new BudgetTracker(config.budget)
  const turns: TurnRecord[] = []
  let turnSequence = 0

  // Create session in database
  const sessionId = await stores.sessions.createSession(config.sessionNumber)

  // Track message sequence numbers for compaction (maps in-memory index to DB sequence)
  // We'll track the DB sequence numbers as we append messages
  let messageSequences: number[] = []

  // Helper to persist a message (fire-and-forget, logs errors but doesn't throw)
  const persistMessage = async (message: Message, room: string, turnSeq?: number): Promise<void> => {
    try {
      const msgId = await stores.sessions.appendMessage(sessionId, message, room, turnSeq)
      // Track the sequence number (it's the length of persisted messages)
      messageSequences.push(messageSequences.length + 1)
    } catch (error) {
      console.error("Failed to persist message:", error)
    }
  }

  // Initialize agent context
  const context: AgentContext = {
    agentId: agentState.agentId,
    workspace: agentState.workspace,
    stores,
    currentRoom: "bedroom",
    currentSession: config.sessionNumber,
    budget: budget.getState(),
    signals: {
      requestedSleep: false,
      requestedMove: null,
    },
  }

  let messages: Message[] = []

  // Wake up message
  const startRoom = registry.get("bedroom")!
  const memoryCount = await stores.memories.getCount()
  const pendingTodoCount = await stores.todos.getPendingCount()
  const wakeUpContext: WakeUpContext = {
    session: config.sessionNumber,
    currentRoom: startRoom,
    reflections: config.reflections,
    inboxCount: config.inboxCount,
    previousSessionSummary: config.previousSessionSummary,
    memoryCount,
    pendingTodoCount,
  }

  const wakeUpMessage: Message = {
    role: "user",
    content: buildWakeUpMessage(wakeUpContext, stores.decorations),
  }
  messages.push(wakeUpMessage)
  await persistMessage(wakeUpMessage, context.currentRoom)

  console.log(`\n☀️  Session ${config.sessionNumber} begins`)
  console.log(`📍 Bedroom`)

  // Apply any persona edit queued in a previous session, then build the system
  // prompt and the room-independent tool set ONCE for the whole session. Both are
  // static per session — persona changes are deferred to the next session (see
  // PersonaStore) and the tool set never varies by room — so freezing them here
  // keeps the prompt-cache prefix identical on every turn.
  stores.persona.activatePending()
  const systemPrompt = buildSystemPrompt(stores.persona)
  const tools = registry.getStaticToolDefinitions()

  // One turn: an LLM completion plus any tool executions it triggers. Wrapped in
  // a turn span by the main loop below so the completion and tool calls nest under
  // it in traces instead of each turn being a single opaque leaf. Defined as a
  // closure so it shares the loop's mutable state (messages, budget, context, …).
  const runTurn = async (turnSpan: TurnSpanHandle): Promise<void> => {
    // Surface what this turn is responding to at the turn level. The full model
    // input (system + whole history) lives on the nested `completion`; here we
    // record just the latest user message — the prompt driving the turn.
    turnSpan.setInput(messages.findLast((m) => m.role === "user")?.content ?? null)

    // Call LLM. `availableTools` (the full injected set) is recorded by the
    // traced provider from `tools`; `roomTools` records the subset unique to the
    // current room, so traces show both the room-independent superset we send and
    // what the current room actually contributed.
    const response = await llm.send(systemPrompt, messages, tools, {
      name: "completion",
      metadata: {
        turn: turnSequence,
        room: context.currentRoom,
        roomTools: registry.getRoomToolNames(context.currentRoom),
      },
    })

    // Record usage
    budget.recordUsage(response.usage.inputTokens, response.usage.outputTokens, response.usage.cost, response.usage.cacheSavings)
    context.budget = budget.getState()

    // Check if context compaction is needed (separate from daily budget)
    if (shouldCompact(response.usage.inputTokens)) {
      const originalTokens = response.usage.inputTokens
      const result = await compactMessages(messages, llm)
      
      // Record compaction in database before updating in-memory state
      if (result.compactedRange && result.summaryText) {
        // Map in-memory indices to database sequence numbers
        const rangeStartSeq = messageSequences[result.compactedRange.startIndex] ?? 1
        const rangeEndSeq = messageSequences[result.compactedRange.endIndex] ?? messageSequences.length
        
        try {
          await stores.sessions.recordCompaction(
            sessionId,
            rangeStartSeq,
            rangeEndSeq,
            result.summaryText,
            result.summaryTokens,
            "anthropic/claude-opus-4.5", // Model used for summarization
            originalTokens
          )
          // Reset sequence tracking since we've compacted
          // The summary message + recent messages are now the active set
          messageSequences = Array.from(
            { length: result.compactedMessageCount },
            (_, i) => rangeEndSeq + 1 + i
          )
        } catch (error) {
          console.error("Failed to record compaction:", error)
        }
      }
      
      messages = result.messages

      // Log context sizes: original vs estimated new size
      // New size is roughly the summary tokens + tokens from recent messages
      // (exact count will be visible on next turn)
      console.log(`\n📦 Context compaction triggered`)
      console.log(`   Original: ${Math.round(originalTokens / 1000)}k tokens (${result.originalMessageCount} messages)`)
      console.log(`   Compacted: ~${Math.round(result.summaryTokens / 1000)}k summary + recent (${result.compactedMessageCount} messages)`)
    }

    // Initialize turn record
    const turn: TurnRecord = {
      sequence: turnSequence,
      room: context.currentRoom,
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
      cost: response.usage.cost,
      assistantMessage: response.content,
      toolCalls: response.toolCalls,
      toolResults: [],
    }

    // Log assistant response
    if (response.content) {
      console.log(`\n💭 ${response.content}\n`)
    }

    // Handle tool calls
    if (response.toolCalls.length > 0) {
      // Add assistant message with tool calls
      const assistantMessage: Message = {
        role: "assistant",
        content: response.content,
        toolCalls: response.toolCalls,
      }
      messages.push(assistantMessage)

      // Redact tool call args for tools that opt out of input persistence. For an
      // execute_room_tool envelope this resolves to the inner room tool, so its
      // persistInput flag still applies even though the loop sees the wrapper.
      const redactedToolCalls = response.toolCalls.map((tc) => {
        const t = registry.getToolForPersistence(context.currentRoom, tc.name, tc.args)
        if (t?.persistInput === false) {
          return { ...tc, args: { _redacted: true } }
        }
        return tc
      })
      await persistMessage(
        { ...assistantMessage, toolCalls: redactedToolCalls },
        context.currentRoom,
        turnSequence
      )

      // Execute each tool
      for (const toolCall of response.toolCalls) {
        // For an execute_room_tool envelope, persistence + decay + the trace span
        // should reflect the inner room tool, not the wrapper: honor its persist
        // flags and label stubs/spans with its real name.
        const persistenceTool = registry.getToolForPersistence(
          context.currentRoom,
          toolCall.name,
          toolCall.args
        )
        const effectiveName = persistenceTool?.name ?? toolCall.name

        // Keep opted-out tool I/O out of traces too, mirroring DB redaction.
        const tracedInput = persistenceTool?.persistInput === false ? "[redacted]" : toolCall.args

        const result = await withToolSpan(
          { name: effectiveName, input: tracedInput, metadata: { call: toolCall.name } },
          async (toolSpan): Promise<ToolResult> => {
            const tool = registry.getExecutableTool(context.currentRoom, toolCall.name)

            let r: ToolResult
            if (!tool) {
              // The full tool set is advertised to the LLM regardless of room (for
              // prompt-cache stability), so an unresolved tool here is either out of
              // scope — defined in another room — or genuinely unknown. Tell the
              // agent which, and where to go if it's just in the wrong room.
              const elsewhere = registry.getRoomsForTool(toolCall.name)
              const here = registry.get(context.currentRoom)?.name ?? context.currentRoom
              r = {
                success: false,
                output:
                  elsewhere.length > 0
                    ? `The "${toolCall.name}" tool isn't available in the ${here}. It's available in: ${elsewhere.join(", ")}. Use move_to to go there first.`
                    : `Unknown tool: ${toolCall.name}`,
              }
            } else {
              // Validate args against the tool's input schema
              const parsed = tool.inputSchema.safeParse(toolCall.args)
              if (!parsed.success) {
                const errors = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
                r = {
                  success: false,
                  output: `Invalid arguments for ${toolCall.name}: ${errors}`,
                }
                console.log(`\n🔧 ${toolCall.name} — validation failed: ${errors}`)
              } else {
                console.log(`\n🔧 ${toolCall.name}`)
                r = await tool.execute(parsed.data, context)
                console.log(`   ${r.output.slice(0, 80)}${r.output.length > 250 ? "..." : ""}`)
              }
            }

            // Record on the span, honoring the inner tool's result-persistence opt-out.
            if (!r.success) toolSpan.setError(r.output)
            toolSpan.setOutput(
              persistenceTool?.persistResult === false
                ? `[${effectiveName}: ${r.output.length} chars, not traced]`
                : r.output
            )
            return r
          }
        )

        turn.toolResults.push({ name: toolCall.name, result })

        // Add tool result message
        const toolResultMessage: Message = {
          role: "tool",
          content: result.output,
          toolCallId: toolCall.id,
          decay: { turn: turnSequence, toolName: effectiveName },
        }
        messages.push(toolResultMessage)

        // Persist with redacted content if the tool opts out of result persistence
        if (persistenceTool?.persistResult === false) {
          await persistMessage(
            { ...toolResultMessage, content: `[${effectiveName} result not persisted]` },
            context.currentRoom,
            turnSequence
          )
        } else {
          await persistMessage(toolResultMessage, context.currentRoom, turnSequence)
        }

        // Handle room state updates
        if (result.stateUpdate) {
          registry.updateRoomState(context.currentRoom, result.stateUpdate)
        }
      }

      // Collect notifications for this turn
      const notifications: TurnNotifications = {}

      // Handle room transition
      if (context.signals.requestedMove) {
        const targetRoom = context.signals.requestedMove
        context.signals.requestedMove = null

        // Execute onExit for current room
        await registry.executeOnExit(context.currentRoom, context)

        // Move to new room
        context.currentRoom = targetRoom
        console.log(`\n📍 ${registry.get(targetRoom)?.name ?? targetRoom}`)

        // Execute onEnter for new room
        const enterMessage = await registry.executeOnEnter(targetRoom, context)

        // Store room entry for notification (instead of immediate message)
        const newRoom = registry.get(targetRoom)!
        notifications.roomEntry = {
          room: newRoom,
          enterMessage: typeof enterMessage === "string" ? enterMessage : undefined,
        }
      }

      // Check for unread inbox
      const inboxCount = stores.letters.getUnreadCount()
      if (inboxCount > 0) {
        notifications.inboxCount = inboxCount
      }

      // Build prompt with optional notifications (always add a user message after tool calls)
      const notificationContent = buildNotificationMessage(notifications, stores.decorations)
      if (notificationContent) {
        const promptContent = `You have received the following notifications: ${notificationContent}`
        const promptMessage: Message = {
          role: "user",
          content: promptContent,
        }
        messages.push(promptMessage)
        await persistMessage(promptMessage, context.currentRoom, turnSequence)
      }

    } else {
      // No tool calls, just a text response
      const textResponse: Message = {
        role: "assistant",
        content: response.content,
      }
      messages.push(textResponse)
      await persistMessage(textResponse, context.currentRoom, turnSequence)

      // Collect notifications
      const notifications: TurnNotifications = {}

      // Check for unread inbox
      const inboxCount = stores.letters.getUnreadCount()
      if (inboxCount > 0) {
        notifications.inboxCount = inboxCount
      }

      // Build prompt with optional notifications
      const notificationContent = buildNotificationMessage(notifications, stores.decorations)
      const promptContent = notificationContent
        ? `${notificationContent}\n\nWhat would you like to do?`
        : "What would you like to do?"

      const promptMessage: Message = {
        role: "user",
        content: promptContent,
      }
      messages.push(promptMessage)
      await persistMessage(promptMessage, context.currentRoom, turnSequence)
    }

    // Log token usage, context window size, and budget state
    const budgetState = budget.getState()
    const budgetPercent = Math.round((budgetState.remaining / budgetState.total) * 100)
    const costStr = turn.cost != null ? ` | $${turn.cost.toFixed(4)}` : ""
    const totalCostStr = budgetState.totalCost > 0 ? ` | Total cost: $${budgetState.totalCost.toFixed(4)}` : ""
    console.log(`\n📊 Turn ${turnSequence}`)
    console.log(`   Usage: ${turn.inputTokens.toLocaleString()} input tokens | ${turn.outputTokens.toLocaleString()} output tokens${costStr}`)
    console.log(`   Context: ${messages.length} messages, ~${messages.reduce((acc, msg) => acc + (msg.content?.length ?? 0) / 4, 0)} tokens`)
    console.log(`   Budget: ${budgetState.remaining.toLocaleString()} tokens / ${budgetState.total.toLocaleString()} tokens (${budgetPercent}%)${totalCostStr}`)

    // Summarize the turn on its span for at-a-glance reading in traces.
    turnSpan.setOutput({
      content: turn.assistantMessage,
      toolsCalled: turn.toolResults.map((r) => r.name),
      inputTokens: turn.inputTokens,
      outputTokens: turn.outputTokens,
    })

    turns.push(turn)

    // Record turn in database
    try {
      await stores.sessions.recordTurn(sessionId, turn)
    } catch (error) {
      console.error("Failed to record turn:", error)
    }

    // Decay stale tool results to reduce context size on subsequent turns
    decayToolResults(messages, turnSequence)
  }

  // Main loop. Each turn runs inside its own span so the LLM completion and the
  // tool executions it triggers appear nested beneath it.
  //
  // The session ends only when the agent chooses to — the shutdown tool sets
  // requestedSleep. Budget exhaustion no longer terminates the loop: the budget
  // is still tracked, but BudgetTracker.isExhausted() is intentionally left
  // unwired here so a session is bounded only by the agent's own decision.
  while (!context.signals.requestedSleep) {
    turnSequence++
    await withTurnSpan({ turn: turnSequence, room: context.currentRoom }, runTurn)
  }

  // Determine end reason. With budget exhaustion unwired from the main loop, a
  // session can only end via the shutdown tool, so this currently always
  // resolves to "sleep". The budget_exhausted branch (and its logging below) is
  // kept intact for if/when exhaustion is rewired.
  const endReason = context.signals.requestedSleep ? "sleep" : "budget_exhausted"

  if (endReason === "sleep") {
    console.log(`\n🌙 Session ${config.sessionNumber} ends. The agent sleeps.`)
  } else {
    console.log(`\n💫 Session ${config.sessionNumber} ends. Budget exhausted—the agent passes out.`)
  }

  // Generate session summary for the next session
  console.log(`\n📝 Generating session summary...`)
  const sessionSummary = await generateSessionSummary(llm, turns, config.sessionNumber)
  if (sessionSummary) {
    console.log(`   Summary: ${sessionSummary}`)
  }

  // Record the session-level trace output.
  const finalState = budget.getState()

  // % of total cost saved by prompt caching this session. The counterfactual
  // (no-cache) bill is what we actually paid plus what caching saved, so a
  // write-heavy session with few reads can legitimately show a negative %.
  const counterfactualCost = finalState.totalCost + finalState.totalCacheSavings
  const cacheCostSavingsPct =
    counterfactualCost > 0
      ? Math.round((finalState.totalCacheSavings / counterfactualCost) * 1000) / 10
      : 0

  trace.setOutput({
    endReason,
    totalTokensUsed: finalState.spent,
    totalCost: finalState.totalCost,
    cacheCostSavingsUsd: finalState.totalCacheSavings,
    cacheCostSavingsPct,
    turns: turns.length,
    sessionSummary,
  })
  trace.setMetadata({ cacheCostSavingsUsd: finalState.totalCacheSavings, cacheCostSavingsPct })

  // Emit chartable Langfuse Scores (only when we actually have cost data).
  if (finalState.totalCost > 0) {
    trace.score("cache_cost_savings_pct", cacheCostSavingsPct, {
      comment: `$${finalState.totalCacheSavings.toFixed(4)} saved across ${turns.length} turns`,
    })
    trace.score("cache_cost_savings_usd", Math.round(finalState.totalCacheSavings * 1e6) / 1e6)
  }

  // End session in database
  try {
    await stores.sessions.endSession(
      sessionId,
      endReason,
      finalState.spent,
      sessionSummary,
      finalState.totalCost
    )
  } catch (error) {
    console.error("Failed to end session in database:", error)
  }

  return {
    sessionNumber: config.sessionNumber,
    endReason,
    totalTokensUsed: finalState.spent,
    totalCost: finalState.totalCost,
    turns,
    sessionSummary,
  }
}

/**
 * Generates a summary of the session for continuity into the next session.
 */
async function generateSessionSummary(
  llm: LLMProvider,
  turns: TurnRecord[],
  sessionNumber: number
): Promise<string | null> {
  if (turns.length === 0) {
    return null
  }

  // Build a condensed view of what happened in the session
  const sessionEvents: string[] = []
  for (const turn of turns) {
    if (turn.assistantMessage) {
      sessionEvents.push(`[Thought] ${turn.assistantMessage}`)
    }
    for (const tc of turn.toolCalls) {
      sessionEvents.push(`[Action] ${tc.name}(${JSON.stringify(tc.args)})`)
    }
    for (const tr of turn.toolResults) {
      const outputPreview = tr.result.output.slice(0, 200)
      sessionEvents.push(`[Result] ${tr.name}: ${outputPreview}${tr.result.output.length > 200 ? "..." : ""}`)
    }
  }

  const summaryPrompt = `You are summarizing a session for an AI agent living in a virtual home. This summary will be shown to the agent at the start of their next session to provide continuity.

Session ${sessionNumber} events:
${sessionEvents.join("\n")}

Write a brief summary (2-4 sentences) of what happened this session. Focus on:
- Key actions taken and their outcomes
- Any ongoing tasks or unfinished work
- Important information learned or decisions made

Be concise and factual. Write in second person ("You did X, then Y").`

  try {
    const response = await llm.send(
      "You are a helpful assistant that summarizes sessions concisely.",
      [{ role: "user", content: summaryPrompt }],
      [],
      { name: "session-summary" }
    )
    return response.content?.trim() ?? null
  } catch (error) {
    console.error("Failed to generate session summary:", error)
    return null
  }
}