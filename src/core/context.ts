import type { Room } from "../types/rooms"
import { resolveDescription } from "../types/rooms"
import type { PersonaStore } from "../data/persona"
import type { RoomDecorationStore } from "../data/decorations"

/**
 * Data available at wake-up.
 */
export interface WakeUpContext {
  session: number
  currentRoom: Room
  reflections: string[] // Relevant past reflections
  inboxCount: number // Unread messages
  previousSessionSummary: string | null // Summary of the previous session
  memoryCount: number // Number of stored memories
  pendingTodoCount: number // Number of pending todos
}

/**
 * Builds the system prompt for the agent.
 * The persona is loaded from the persona store and placed at the very beginning,
 * followed by the mechanics section and the always-available (universal) tools.
 *
 * This is static for the whole session: the persona only changes between sessions
 * (see {@link import("../data/persona").PersonaStore}) and the universal tool list
 * is fixed, so it can be built once and read identically on every turn — keeping
 * the prompt cache valid.
 */
export function buildSystemPrompt(persona: PersonaStore): string {
  const personaText = persona.getPersona()

  return `${personaText}

You've been granted a virtual home to live in. You can move between rooms in your home to complete tasks and respond to messages.

Mechanics:
- You navigate between rooms using the move_to tool. Each room has its own tools; the "Tools in this room" list shown when you wake up or enter a room tells you what's available there.
- To use one of the current room's tools, call execute_room_tool with the tool's name and its arguments. Call get_room_tool_def first if you need to see a tool's arguments.
- A room's tools only work while you're in that room; if the tool you want lives elsewhere, move there first.

Always available (call directly, in any room):
- move_to: Move to another room in the house.
- decorate_room: Customize this room's description.
- remember: Store something in long-term memory.
- recall: Search your memories and past sessions.
- forget: Remove a memory by ID.
- todo: Create, view, and update todos that persist across sessions.
- get_room_tool_def: Show a room tool's input schema before you call it.`
}

/**
 * Lists the current room's own tools. Shown on wake-up and room entry.
 *
 * Only room-specific tools appear here — the universal tools (move_to, remember,
 * …) live in the system prompt (see {@link buildSystemPrompt}), since they're the
 * same in every room. Room tools aren't sent to the LLM as individual definitions
 * (the tool list is kept static for prompt-cache stability — see
 * {@link import("../rooms/registry").RoomRegistry.getStaticToolDefinitions}), so
 * this list is the agent's catalogue of what the current room offers; they're
 * invoked via execute_room_tool. Returns an empty list for a room with no tools.
 */
function buildAvailableActions(room: Room): string[] {
  const lines: string[] = []

  if (room.tools.length > 0) {
    lines.push("Tools in this room (invoke with execute_room_tool, passing the tool's name and arguments):")
    for (const tool of room.tools) {
      lines.push(`- ${tool.name}: ${tool.description}`)
    }
  }

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

  // The start room's own tools (universal tools live in the system prompt).
  const actions = buildAvailableActions(context.currentRoom)
  if (actions.length > 0) {
    parts.push("")
    parts.push(...actions)
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

  // The room's own tools (universal tools live in the system prompt).
  const actions = buildAvailableActions(room)
  if (actions.length > 0) {
    parts.push("")
    parts.push(...actions)
  }

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
