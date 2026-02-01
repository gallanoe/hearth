import type { LLMProvider, Message, ToolCall } from "../llm/types"
import type { AgentContext, ToolResult } from "../rooms/types"
import { roomRegistry } from "../rooms/registry"
import { BudgetTracker, type BudgetConfig } from "./budget"
import {
  buildSystemPrompt,
  buildWakeUpMessage,
  buildRoomEntryMessage,
  type WakeUpContext,
} from "./context"
import { shouldCompact, compactMessages } from "./compaction"
import { sessionStore, type SessionStore } from "../data/sessions"

/**
 * Configuration for running a session.
 */
export interface SessionConfig {
  sessionNumber: number
  budget: BudgetConfig
  intentions: string | null // From previous session's sleep
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
  intentions: string | null // Set if agent slept intentionally
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
  assistantMessage: string | null
  toolCalls: ToolCall[]
  toolResults: { name: string; result: ToolResult }[]
}

/**
 * Runs a single session in the agent's life.
 * @param llm - The LLM provider to use
 * @param config - Session configuration
 * @param store - Optional session store for persistence (defaults to singleton)
 */
export async function runSession(
  llm: LLMProvider,
  config: SessionConfig,
  store: SessionStore = sessionStore
): Promise<SessionResult> {
  const budget = new BudgetTracker(config.budget)
  const turns: TurnRecord[] = []
  let turnSequence = 0

  // Create session in database
  const sessionId = await store.createSession(config.sessionNumber)

  // Track message sequence numbers for compaction (maps in-memory index to DB sequence)
  // We'll track the DB sequence numbers as we append messages
  let messageSequences: number[] = []

  // Helper to persist a message (fire-and-forget, logs errors but doesn't throw)
  const persistMessage = async (message: Message, room: string, turnSeq?: number): Promise<void> => {
    try {
      const msgId = await store.appendMessage(sessionId, message, room, turnSeq)
      // Track the sequence number (it's the length of persisted messages)
      messageSequences.push(messageSequences.length + 1)
    } catch (error) {
      console.error("Failed to persist message:", error)
    }
  }

  // Initialize agent context
  const context: AgentContext = {
    currentRoom: "bedroom",
    currentSession: config.sessionNumber,
    budget: budget.getState(),
    intentions: null,
    signals: {
      requestedSleep: false,
      requestedMove: null,
    },
  }

  let messages: Message[] = []

  // Wake up message
  const startRoom = roomRegistry.get("bedroom")!
  const wakeUpContext: WakeUpContext = {
    session: config.sessionNumber,
    budget: budget.getState(),
    currentRoom: startRoom,
    intentions: config.intentions,
    reflections: config.reflections,
    inboxCount: config.inboxCount,
    previousSessionSummary: config.previousSessionSummary,
  }

  const wakeUpMessage: Message = {
    role: "user",
    content: buildWakeUpMessage(wakeUpContext),
  }
  messages.push(wakeUpMessage)
  await persistMessage(wakeUpMessage, context.currentRoom)

  console.log(`\n☀️  Session ${config.sessionNumber} begins`)
  console.log(`📍 Bedroom`)

  // Main loop
  while (!budget.isExhausted() && !context.signals.requestedSleep) {
    turnSequence++

    // Get available tools for current room
    const tools = roomRegistry.getToolDefinitions(context.currentRoom)

    // Build system prompt with current budget state (refreshed each turn)
    const systemPrompt = buildSystemPrompt(budget.getState())

    // Call LLM
    const response = await llm.send(systemPrompt, messages, tools)

    // Record usage
    budget.recordUsage(response.usage.inputTokens, response.usage.outputTokens)
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
          await store.recordCompaction(
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
      await persistMessage(assistantMessage, context.currentRoom, turnSequence)

      // Execute each tool
      for (const toolCall of response.toolCalls) {
        const tool = roomRegistry.getExecutableTool(context.currentRoom, toolCall.name)

        let result: ToolResult
        if (!tool) {
          result = {
            success: false,
            output: `Unknown tool: ${toolCall.name}`,
          }
        } else {
          console.log(`\n🔧 ${toolCall.name}`)
          result = await tool.execute(toolCall.args, context)
          console.log(`   ${result.output.slice(0, 80)}${result.output.length > 250 ? "..." : ""}`)
        }

        turn.toolResults.push({ name: toolCall.name, result })

        // Add tool result message
        const toolResultMessage: Message = {
          role: "tool",
          content: result.output,
          toolCallId: toolCall.id,
        }
        messages.push(toolResultMessage)
        await persistMessage(toolResultMessage, context.currentRoom, turnSequence)

        // Handle room state updates
        if (result.stateUpdate) {
          roomRegistry.updateRoomState(context.currentRoom, result.stateUpdate)
        }
      }

      // Handle room transition
      if (context.signals.requestedMove) {
        const targetRoom = context.signals.requestedMove
        context.signals.requestedMove = null

        // Execute onExit for current room
        await roomRegistry.executeOnExit(context.currentRoom, context)

        // Move to new room
        context.currentRoom = targetRoom
        console.log(`\n📍 ${roomRegistry.get(targetRoom)?.name ?? targetRoom}`)

        // Execute onEnter for new room
        const enterMessage = await roomRegistry.executeOnEnter(targetRoom, context)

        // Build room entry message
        const newRoom = roomRegistry.get(targetRoom)!
        const roomMessage = buildRoomEntryMessage(newRoom, typeof enterMessage === "string" ? enterMessage : undefined)

        const roomEntryMessage: Message = {
          role: "user",
          content: roomMessage,
        }
        messages.push(roomEntryMessage)
        await persistMessage(roomEntryMessage, context.currentRoom, turnSequence)
      }

    } else {
      // No tool calls, just a text response
      const textResponse: Message = {
        role: "assistant",
        content: response.content,
      }
      messages.push(textResponse)
      await persistMessage(textResponse, context.currentRoom, turnSequence)

      // Prompt for action
      const promptMessage: Message = {
        role: "user",
        content: "What would you like to do?",
      }
      messages.push(promptMessage)
      await persistMessage(promptMessage, context.currentRoom, turnSequence)
    }

    // Log token usage, context window size, and budget state
    const budgetState = budget.getState()
    const budgetPercent = Math.round((budgetState.remaining / budgetState.total) * 100)
    console.log(`\n📊 Turn ${turnSequence}`)
    console.log(`   Usage: ${turn.inputTokens.toLocaleString()} input tokens | ${turn.outputTokens.toLocaleString()} output tokens`)
    console.log(`   Context: ${messages.length} messages, ~${messages.reduce((acc, msg) => acc + (msg.content?.length ?? 0) / 4, 0)} tokens`)
    console.log(`   Budget: ${budgetState.remaining.toLocaleString()} tokens / ${budgetState.total.toLocaleString()} tokens (${budgetPercent}%)`)

    turns.push(turn)

    // Record turn in database
    try {
      await store.recordTurn(sessionId, turn)
    } catch (error) {
      console.error("Failed to record turn:", error)
    }
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
  try {
    await store.endSession(
      sessionId,
      endReason,
      budget.getState().spent,
      context.intentions,
      sessionSummary
    )
  } catch (error) {
    console.error("Failed to end session in database:", error)
  }

  return {
    sessionNumber: config.sessionNumber,
    endReason,
    totalTokensUsed: budget.getState().spent,
    intentions: context.intentions,
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