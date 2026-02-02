import type { LLMProvider, Message } from "../types/llm"
import { COMPACTION_TRIGGER, RECENT_MESSAGES_TO_KEEP } from "../config"

/**
 * Check if compaction is needed based on current context size.
 */
export function shouldCompact(inputTokens: number, trigger?: number): boolean {
  return inputTokens >= (trigger ?? COMPACTION_TRIGGER)
}

/**
 * The prompt used to generate a summary of older messages.
 * Framed around Hearth's concept of an agent living in a home with memory continuity.
 */
const SUMMARIZATION_PROMPT = `You are creating a memory summary for an AI agent living in a simulated home where the agent wakes, moves between rooms, and sleeps across sessions.

Summarize what happened earlier in this session. The summary will be shown directly to the agent, so write in second person ("You visited the library and read..."). Preserve:

- Where you went and what you did in each room
- Letters read or written, and their content/who they were from
- Books or passages read, and any thoughts about them
- Reflections, decisions, or intentions you expressed
- Meaningful discoveries or information learned
- Any ongoing activities or interests being pursued

Be specific about names, details, and outcomes. Keep it concise but complete enough to continue the session with full context.

Do not include meta-commentary about the summarization process.`

/**
 * Result of a compaction operation.
 */
export interface CompactionResult {
  messages: Message[]
  originalMessageCount: number
  compactedMessageCount: number
  summaryTokens: number // Tokens used by the summary (rough estimate of new context contribution)
  // Range of indices into the original array that were compacted
  compactedRange: { startIndex: number; endIndex: number } | null
  // The summary text for persistence
  summaryText: string | null
}

/**
 * Compact messages by summarizing older ones while preserving recent context.
 * 
 * @param messages - The current message history
 * @param llm - The LLM provider to use for summarization
 * @returns Compaction result with new messages and stats
 */
export async function compactMessages(
  messages: Message[],
  llm: LLMProvider
): Promise<CompactionResult> {
  // If we don't have enough messages to compact, return as-is
  if (messages.length <= RECENT_MESSAGES_TO_KEEP) {
    return {
      messages,
      originalMessageCount: messages.length,
      compactedMessageCount: messages.length,
      summaryTokens: 0,
      compactedRange: null,
      summaryText: null,
    }
  }

  // Split messages: older ones to summarize, recent ones to keep
  const splitIndex = messages.length - RECENT_MESSAGES_TO_KEEP
  const olderMessages = messages.slice(0, splitIndex)
  const recentMessages = messages.slice(splitIndex)

  // Format older messages for summarization
  const formattedHistory = formatMessagesForSummary(olderMessages)

  // Generate summary using the LLM
  const summaryResponse = await llm.send(
    SUMMARIZATION_PROMPT,
    [{ role: "user", content: formattedHistory }],
    [] // No tools needed for summarization
  )

  const summary = summaryResponse.content ?? "No summary generated."

  // Create the compacted message array
  const summaryMessage: Message = {
    role: "user",
    content: `[Earlier this session]\n${summary}\n[The session continues...]`,
  }

  const compactedMessages = [summaryMessage, ...recentMessages]

  return {
    messages: compactedMessages,
    originalMessageCount: messages.length,
    compactedMessageCount: compactedMessages.length,
    summaryTokens: summaryResponse.usage.outputTokens, // The summary size
    compactedRange: { startIndex: 0, endIndex: splitIndex - 1 },
    summaryText: summary,
  }
}

/**
 * Format messages into a readable transcript for summarization.
 */
function formatMessagesForSummary(messages: Message[]): string {
  const parts: string[] = ["Summarize the following conversation history:\n"]

  for (const msg of messages) {
    const role = msg.role.toUpperCase()
    
    if (msg.role === "tool") {
      // Format tool results more concisely
      parts.push(`TOOL RESULT: ${truncate(msg.content ?? "", 500)}`)
    } else if (msg.toolCalls && msg.toolCalls.length > 0) {
      // Format tool calls
      const toolNames = msg.toolCalls.map(tc => tc.name).join(", ")
      parts.push(`ASSISTANT: [Called tools: ${toolNames}]`)
      if (msg.content) {
        parts.push(`  ${truncate(msg.content, 300)}`)
      }
    } else {
      parts.push(`${role}: ${truncate(msg.content ?? "", 500)}`)
    }
  }

  return parts.join("\n")
}

/**
 * Truncate a string to a maximum length.
 */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength) + "..."
}
