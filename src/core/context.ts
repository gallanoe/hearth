import type { BudgetState } from "./budget"
import type { Room } from "../types/rooms"
import { resolveDescription } from "../types/rooms"
import type { PersonaStore } from "../data/persona"
import type { RoomDecorationStore } from "../data/decorations"

/**
 * Data available at wake-up.
 */
export interface WakeUpContext {
  session: number
  budget: BudgetState
  currentRoom: Room
  reflections: string[] // Relevant past reflections
  inboxCount: number // Unread messages
  previousSessionSummary: string | null // Summary of the previous session
  memoryCount: number // Number of stored memories
  openPlanCount: number // Number of open plans
  activePlanTitle: string | null // Title of the active plan, if any
}

/**
 * Formats the budget display for the system prompt.
 * Includes a warning marker when budget is low.
 */
function formatBudgetDisplay(budget: BudgetState): string {
  const remaining = budget.remaining.toLocaleString()
  const total = budget.total.toLocaleString()
  const percent = Math.round((budget.remaining / budget.total) * 100)
  const isLow = budget.remaining <= budget.warningThreshold
  
  if (isLow) {
    return `⚠️ BUDGET LOW: ${remaining} / ${total} tokens (${percent}%) — Consider wrapping up and heading to bed.`
  }
  return `Budget: ${remaining} / ${total} tokens (${percent}%)`
}

/**
 * Builds the system prompt for the agent.
 * The persona is loaded from the persona store and placed at the very beginning.
 * The mechanics section follows the persona.
 * Budget state is displayed and updated each turn.
 */
export function buildSystemPrompt(budget: BudgetState, persona: PersonaStore): string {
  const personaText = persona.getPersona()
  
  return `${personaText}

You've been granted a virtual home to live in. You can move between rooms in your home to complete tasks and respond to messages.

Mechanics:
- Each session you have a limited token budget. This is your energy for the session.
- When your budget is exhausted, the session ends.
- To end a session intentionally, return to your bedroom and use the sleep tool.
- If you exceed your budget, you will pass out and the session will end.
- You navigate between rooms using the move_to tool. Each room has different tools available.

${formatBudgetDisplay(budget)}`
}

/**
 * Builds the initial wake-up message for a new session.
 */
export function buildWakeUpMessage(context: WakeUpContext, decorations: RoomDecorationStore): string {
  const parts: string[] = []

  // Session narration
  parts.push(`Session ${context.session}.`)
  parts.push("")
  // Use decorated description if available, otherwise resolve default
  const roomDescription = decorations.getDecoratedDescription(context.currentRoom.id) ?? resolveDescription(context.currentRoom.description)
  parts.push(roomDescription)

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

  // Memory status
  if (context.memoryCount > 0) {
    parts.push("")
    const plural = context.memoryCount === 1 ? "memory" : "memories"
    parts.push(`${context.memoryCount} stored ${plural}. Use recall to search them.`)
  }

  // Plan status
  if (context.openPlanCount > 0) {
    parts.push("")
    const plural = context.openPlanCount === 1 ? "plan" : "plans"
    if (context.activePlanTitle) {
      parts.push(`${context.openPlanCount} open ${plural}. Active: "${context.activePlanTitle}".`)
    } else {
      parts.push(`${context.openPlanCount} open ${plural}.`)
    }
  }

  return parts.join("\n")
}

/**
 * Builds the message shown when entering a new room.
 */
export function buildRoomEntryMessage(room: Room, decorations: RoomDecorationStore, extraContext?: string): string {
  const parts: string[] = []

  parts.push(`You are now in the ${room.name}.`)
  parts.push("")
  // Use decorated description if available, otherwise resolve default
  const roomDescription = decorations.getDecoratedDescription(room.id) ?? resolveDescription(room.description)
  parts.push(roomDescription)

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
  parts.push("- decorate_room: Customize this room's description.")
  parts.push("- remember: Store something in long-term memory.")
  parts.push("- recall: Search your memories and past sessions.")
  parts.push("- forget: Remove a memory by ID.")
  parts.push("- plans: Create, view, and update plans that persist across sessions.")

  return parts.join("\n")
}

/**
 * Notifications that can be shown to the agent during a turn.
 */
export interface TurnNotifications {
  /** Room the agent just entered (if they moved this turn) */
  roomEntry?: {
    room: Room
    enterMessage?: string
  }
  /** Budget warning when remaining budget is low */
  budgetWarning?: {
    remaining: number
    total: number
    percentRemaining: number
  }
  /** Count of unread letters in inbox */
  inboxCount?: number
}

/**
 * Builds a combined notification message from accumulated notifications.
 * Returns null if there are no notifications to show.
 */
export function buildNotificationMessage(notifications: TurnNotifications, decorations: RoomDecorationStore): string | null {
  const parts: string[] = []

  // Room entry takes priority - it's the most important context
  if (notifications.roomEntry) {
    const { room, enterMessage } = notifications.roomEntry
    parts.push(buildRoomEntryMessage(room, decorations, enterMessage))
  }

  // Budget warning
  if (notifications.budgetWarning && notifications.budgetWarning.percentRemaining <= 20) {
    const { remaining, percentRemaining } = notifications.budgetWarning
    parts.push(`⚠️ Budget warning: ${percentRemaining}% remaining (${remaining.toLocaleString()} tokens). Consider wrapping up soon.`)
  }

  // Inbox notification
  if (notifications.inboxCount && notifications.inboxCount > 0) {
    const plural = notifications.inboxCount === 1 ? "letter" : "letters"
    parts.push(`📬 You have ${notifications.inboxCount} unread ${plural} in your inbox.`)
  }

  if (parts.length === 0) {
    return null
  }

  return parts.join("\n\n")
}
