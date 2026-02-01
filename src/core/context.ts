import type { BudgetState } from "./budget"
import type { Room } from "../rooms/types"
import { personaStore } from "../data/persona"

/**
 * Data available at wake-up.
 */
export interface WakeUpContext {
  session: number
  budget: BudgetState
  currentRoom: Room
  intentions: string | null // From previous session
  reflections: string[] // Relevant past reflections
  inboxCount: number // Unread messages
  previousSessionSummary: string | null // Summary of the previous session
}

/**
 * Builds the system prompt for the agent.
 * The persona is loaded from the persona store and placed at the very beginning.
 * The mechanics section follows the persona.
 */
export function buildSystemPrompt(): string {
  const persona = personaStore.getPersona()
  
  return `${persona}

You've been granted a virtual home to live in. You can move between rooms in your home to complete tasks and respond to messages.

Mechanics:
- Each session you have a limited token budget. This is your energy for the session.
- When your budget is exhausted, the session ends.
- To end a session intentionally, return to your bedroom and use the sleep tool.
- If you exceed your budget, you will pass out and the session will end.
- You navigate between rooms using the move_to tool. Each room has different tools available.
- You can check your remaining budget at any time with check_budget.`
}

/**
 * Builds the initial wake-up message for a new session.
 */
export function buildWakeUpMessage(context: WakeUpContext): string {
  const parts: string[] = []

  // Session narration
  parts.push(`Session ${context.session}.`)
  parts.push("")
  parts.push(context.currentRoom.description)

  // Budget notice
  const budgetK = Math.round(context.budget.total / 1000)
  parts.push("")
  parts.push(`This session's budget: ${budgetK}k tokens.`)

  // Previous session summary
  if (context.previousSessionSummary) {
    parts.push("")
    parts.push("Summary of last session:")
    parts.push(context.previousSessionSummary)
  }

  // Intentions from last session
  if (context.intentions) {
    parts.push("")
    parts.push(`Before sleeping, you noted: "${context.intentions}"`)
  }

  // Relevant reflections
  // if (context.reflections.length > 0) {
  //   parts.push("")
  //   parts.push("From previous reflections:")
  //   for (const reflection of context.reflections) {
  //     parts.push(`- ${reflection}`)
  //   }
  // }

  // Inbox status
  if (context.inboxCount > 0) {
    parts.push("")
    const plural = context.inboxCount === 1 ? "letter" : "letters"
    parts.push(`${context.inboxCount} unread ${plural} in your inbox.`)
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
  parts.push("- check_budget: Check how much of this session's token budget remains.")

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