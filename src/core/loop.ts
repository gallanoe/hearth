import type { LLMProvider, Message, ToolCall } from "../types/llm"
import type { AgentContext, AgentStores, ToolResult } from "../types/rooms"
import { LocalWorkspace, type Workspace } from "../workspace"
import type { RoomRegistry } from "../rooms/registry"
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
import { WORKSPACE_ROOT } from "../config"

/**
 * Configuration for running a session.
 */
export interface SessionConfig {
  sessionNumber: number
  budget: BudgetConfig
  reflections: string[] // Relevant past reflections
  inboxCount: number
  previousSessionSummary: string | null // Summary of the previous session
  agentId?: string // Defaults to "default"
  workspace?: Workspace // Defaults to LocalWorkspace(WORKSPACE_ROOT)
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
 * @param stores - All agent stores (per-agent instances)
 * @param registry - Room registry
 */
export async function runSession(
  llm: LLMProvider,
  config: SessionConfig,
  stores: AgentStores,
  registry: RoomRegistry
): Promise<SessionResult> {
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
  const workspace = config.workspace ?? new LocalWorkspace(WORKSPACE_ROOT)
  const context: AgentContext = {
    agentId: config.agentId ?? "default",
    workspace,
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
  const openPlanCount = await stores.plans.getOpenCount()
  const activePlan = await stores.plans.getActive()
  const wakeUpContext: WakeUpContext = {
    session: config.sessionNumber,
    budget: budget.getState(),
    currentRoom: startRoom,
    reflections: config.reflections,
    inboxCount: config.inboxCount,
    previousSessionSummary: config.previousSessionSummary,
    memoryCount,
    openPlanCount,
    activePlanTitle: activePlan?.title ?? null,
  }

  const wakeUpMessage: Message = {
    role: "user",
    content: buildWakeUpMessage(wakeUpContext, stores.decorations),
  }
  messages.push(wakeUpMessage)
  await persistMessage(wakeUpMessage, context.currentRoom)

  console.log(`\n☀️  Session ${config.sessionNumber} begins`)
  console.log(`📍 Bedroom`)

  // Main loop
  while (!budget.isExhausted() && !context.signals.requestedSleep) {
    turnSequence++

    // Get available tools for current room
    const tools = registry.getToolDefinitions(context.currentRoom)

    // Build system prompt with current budget state (refreshed each turn)
    const systemPrompt = buildSystemPrompt(budget.getState(), stores.persona)

    // Call LLM
    const response = await llm.send(systemPrompt, messages, tools)

    // Record usage
    budget.recordUsage(response.usage.inputTokens, response.usage.outputTokens, response.usage.cost)
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

      // Redact tool call args for tools that opt out of input persistence
      const redactedToolCalls = response.toolCalls.map((tc) => {
        const t = registry.getExecutableTool(context.currentRoom, tc.name)
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
        const tool = registry.getExecutableTool(context.currentRoom, toolCall.name)

        let result: ToolResult
        if (!tool) {
          result = {
            success: false,
            output: `Unknown tool: ${toolCall.name}`,
          }
        } else {
          // Validate args against the tool's input schema
          const parsed = tool.inputSchema.safeParse(toolCall.args)
          if (!parsed.success) {
            const errors = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
            result = {
              success: false,
              output: `Invalid arguments for ${toolCall.name}: ${errors}`,
            }
            console.log(`\n🔧 ${toolCall.name} — validation failed: ${errors}`)
          } else {
            console.log(`\n🔧 ${toolCall.name}`)
            result = await tool.execute(parsed.data, context)
            console.log(`   ${result.output.slice(0, 80)}${result.output.length > 250 ? "..." : ""}`)
          }
        }

        turn.toolResults.push({ name: toolCall.name, result })

        // Add tool result message
        const toolResultMessage: Message = {
          role: "tool",
          content: result.output,
          toolCallId: toolCall.id,
          decay: { turn: turnSequence, toolName: toolCall.name },
        }
        messages.push(toolResultMessage)

        // Persist with redacted content if tool opts out of result persistence
        if (tool?.persistResult === false) {
          await persistMessage(
            { ...toolResultMessage, content: `[${toolCall.name} result not persisted]` },
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

      // Check for budget warning
      const budgetForNotification = budget.getState()
      const percentRemaining = Math.round((budgetForNotification.remaining / budgetForNotification.total) * 100)
      if (budgetForNotification.remaining <= budgetForNotification.warningThreshold) {
        notifications.budgetWarning = {
          remaining: budgetForNotification.remaining,
          total: budgetForNotification.total,
          percentRemaining,
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

      // Check for budget warning
      const budgetForNotification = budget.getState()
      const percentRemaining = Math.round((budgetForNotification.remaining / budgetForNotification.total) * 100)
      if (budgetForNotification.remaining <= budgetForNotification.warningThreshold) {
        notifications.budgetWarning = {
          remaining: budgetForNotification.remaining,
          total: budgetForNotification.total,
          percentRemaining,
        }
      }

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

  // Determine end reason
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

  // End session in database
  const finalState = budget.getState()
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
      []
    )
    return response.content?.trim() ?? null
  } catch (error) {
    console.error("Failed to generate session summary:", error)
    return null
  }
}