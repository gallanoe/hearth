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
  pendingTodoCount: number // Number of pending todos
}

/**
 * Formats the live budget readout shown to the agent each turn.
 * Includes a warning marker when budget is low.
 *
 * This is deliberately NOT part of {@link buildSystemPrompt}: it changes every
 * turn, so it must live at the very tail of the request (after the cached
 * conversation prefix) or it would invalidate the prompt cache on every call.
 */
export function buildBudgetNote(budget: BudgetState): string {
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
 * The persona is loaded from the persona store and placed at the very beginning,
 * followed by the mechanics section.
 *
 * This is fully static within a session so it can be cached and read on every
 * turn. The live budget is injected separately at the tail via
 * {@link buildBudgetNote}.
 */
export function buildSystemPrompt(persona: PersonaStore): string {
  const personaText = persona.getPersona()

  return `${personaText}

You've been granted a virtual home to live in. You can move between rooms in your home to complete tasks and respond to messages.

Mechanics:
- Each session you have a limited token budget. This is your energy for the session.
- When your budget is exhausted, the session ends.
- To end a session intentionally, return to your bedroom and use the sleep tool.
- If you exceed your budget, you will pass out and the session will end.
- You navigate between rooms using the move_to tool. Each room has its own tools; the "Tools in this room" list shown when you wake up or enter a room tells you what's available there.
- To use one of the current room's tools, call execute_room_tool with the tool's name and its arguments. Call get_room_tool_def first if you need to see a tool's arguments.
- A room's tools only work while you're in that room; if the tool you want lives elsewhere, move there first.`
}

/**
 * Lists the actions available in a room. Shown on wake-up and room entry.
 *
 * Room-specific tools aren't sent to the LLM as individual definitions (the tool
 * list is kept static for prompt-cache stability — see
 * {@link import("../rooms/registry").RoomRegistry.getStaticToolDefinitions}), so
 * this list is the agent's catalogue of what the current room offers. Those tools
 * are invoked via execute_room_tool; the universal tools are called directly.
 */
function buildAvailableActions(room: Room): string[] {
  const lines: string[] = []

  if (room.tools.length > 0) {
    lines.push("Tools in this room (invoke with execute_room_tool, passing the tool's name and arguments):")
    for (const tool of room.tools) {
      lines.push(`- ${tool.name}: ${tool.description}`)
    }
    lines.push("")
  }

  lines.push("Always available (call directly):")
  lines.push("- move_to: Move to another room in the house.")
  lines.push("- decorate_room: Customize this room's description.")
  lines.push("- remember: Store something in long-term memory.")
  lines.push("- recall: Search your memories and past sessions.")
  lines.push("- forget: Remove a memory by ID.")
  lines.push("- todo: Create, view, and update todos that persist across sessions.")
  lines.push("- get_room_tool_def: Show a room tool's input schema before you call it.")
  return lines
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

  // Todo status
  if (context.pendingTodoCount > 0) {
    parts.push("")
    const plural = context.pendingTodoCount === 1 ? "todo" : "todos"
    parts.push(`${context.pendingTodoCount} pending ${plural}.`)
  }

  // Available actions in the room the agent wakes up in. The full tool set is
  // always advertised to the LLM, so this is what scopes it to the start room.
  parts.push("")
  parts.push(...buildAvailableActions(context.currentRoom))

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
  parts.push(...buildAvailableActions(room))

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
