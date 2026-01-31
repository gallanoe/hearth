import type { BudgetState } from "./budget"
import type { Room } from "../rooms/types"

/**
 * Data available at wake-up.
 */
export interface WakeUpContext {
  day: number
  budget: BudgetState
  currentRoom: Room
  intentions: string | null // From previous day
  reflections: string[] // Relevant past reflections
  inboxCount: number // Unread messages
}

/**
 * Builds the system prompt for the agent.
 * Purely mechanical—explains the environment without prescribing behavior.
 */
export function buildSystemPrompt(persona?: string): string {
  let systemPrompt = `You are Claude, an AI assistant made by Anthropic. You are helpful, harmless, and honest. You assist users by answering questions, helping with analysis, writing, math, coding, and many other tasks.`
  if (persona) {
    systemPrompt = persona;
  }
  systemPrompt += `
You've been granted a virtual home to live in. You can move between rooms in your home to complete tasks and respond to messages.

Mechanics:
- Each day you have a limited token budget. This is your energy for the day.
- When your budget is exhausted, the day ends.
- To end a day intentionally, return to your bedroom and use the sleep tool.
- If you exceed your budget, you will pass out and the day will end.
- You navigate between rooms using the move_to tool. Each room has different tools available.
- You can check your remaining budget at any time with check_budget.`
  return systemPrompt;
}

/**
 * Builds the initial wake-up message for a new day.
 */
export function buildWakeUpMessage(context: WakeUpContext): string {
  const parts: string[] = []

  // Day narration
  parts.push(`Day ${context.day}.`)
  parts.push("")
  parts.push(context.currentRoom.description)

  // Budget notice
  const budgetK = Math.round(context.budget.total / 1000)
  parts.push("")
  parts.push(`Today's budget: ${budgetK}k tokens.`)

  // Intentions from yesterday
  if (context.intentions) {
    parts.push("")
    parts.push(`Yesterday, before sleeping, you noted: "${context.intentions}"`)
  }

  // Relevant reflections
  if (context.reflections.length > 0) {
    parts.push("")
    parts.push("From previous reflections:")
    for (const reflection of context.reflections) {
      parts.push(`- ${reflection}`)
    }
  }

  // Inbox status
  if (context.inboxCount > 0) {
    parts.push("")
    const plural = context.inboxCount === 1 ? "letter" : "letters"
    parts.push(`${context.inboxCount} unread ${plural} in the entryway.`)
  }

  return parts.join("\n")
}

/**
 * Builds the message shown when entering a new room.
 */
export function buildRoomEntryMessage(room: Room, extraContext?: string): string {
  const parts: string[] = []

  parts.push(`You are now in the ${room.name}.`)
  parts.push("")
  parts.push(room.description)

  if (extraContext) {
    parts.push("")
    parts.push(extraContext)
  }

  // List available tools
  parts.push("")
  parts.push("Available actions:")
  for (const tool of room.tools) {
    parts.push(`- ${tool.name}: ${tool.description}`)
  }
  parts.push("- move_to: Move to another room in the house.")
  parts.push("- check_budget: Check how much of today's token budget remains.")

  return parts.join("\n")
}

/**
 * Builds the budget warning message.
 */
export function buildBudgetWarningMessage(budget: BudgetState): string {
  const remaining = budget.remaining.toLocaleString()
  const percent = Math.round((budget.remaining / budget.total) * 100)

  return `Budget low: ${remaining} tokens remaining (${percent}%).`
}