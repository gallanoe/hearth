import type { Room, ExecutableTool, AgentContext, UniversalTools } from "../types/rooms"
import { resolveDescription } from "../types/rooms"
import type { ToolDefinition } from "../types/llm"
import type { RoomDecorationStore } from "../data/decorations"
import { createMoveTo } from "../tools/navigation"
import { readInbox, sendMessage } from "../tools/communication"
import { createDecorateRoom } from "../tools/decorations"
import { remember, recall, forget } from "../tools/memory"
import { todo } from "../tools/todo"

/**
 * Registry for all rooms in the house.
 * Handles room lookup, navigation validation, and tool resolution.
 */
export class RoomRegistry {
  private rooms: Map<string, Room> = new Map()
  private roomStates: Map<string, Record<string, unknown>> = new Map()
  private universalTools: UniversalTools

  constructor(private decorationStore: RoomDecorationStore) {
    this.universalTools = {
      moveTo: createMoveTo(this),
      readInbox,
      sendMessage,
      decorateRoom: createDecorateRoom(this),
      remember,
      recall,
      forget,
      todo,
    }
  }

  /**
   * Register a room in the house.
   */
  register(room: Room): void {
    this.rooms.set(room.id, room)
    // Initialize state if room has a state schema
    if (room.stateSchema) {
      this.roomStates.set(room.id, {})
    }
  }

  /**
   * Get a room by ID.
   */
  get(roomId: string): Room | undefined {
    return this.rooms.get(roomId)
  }

  /**
   * Get all registered room IDs.
   */
  getAllRoomIds(): string[] {
    return Array.from(this.rooms.keys())
  }

  /**
   * Check if a transition from one room to another is valid.
   */
  canTransition(fromRoomId: string, toRoomId: string): boolean {
    const fromRoom = this.rooms.get(fromRoomId)
    if (!fromRoom) return false
    if (!this.rooms.has(toRoomId)) return false

    if (fromRoom.transitions === "*") return true
    return fromRoom.transitions.includes(toRoomId)
  }

  /**
   * Get the persistent state for a room.
   */
  getRoomState(roomId: string): Record<string, unknown> | undefined {
    return this.roomStates.get(roomId)
  }

  /**
   * Get the effective description for a room (decorated or default).
   */
  getRoomDescription(roomId: string): string | undefined {
    const room = this.rooms.get(roomId)
    if (!room) return undefined

    // Return decorated description if set, otherwise resolve the default
    return this.decorationStore.getDecoratedDescription(roomId) ?? resolveDescription(room.description)
  }

  /**
   * Update the persistent state for a room.
   */
  updateRoomState(roomId: string, update: Record<string, unknown>): void {
    const current = this.roomStates.get(roomId) ?? {}
    this.roomStates.set(roomId, { ...current, ...update })
  }

  /**
   * Get all available tools for a room (room tools + universal tools).
   * Returns them in ToolDefinition format for the LLM.
   */
  getToolDefinitions(roomId: string): ToolDefinition[] {
    const room = this.rooms.get(roomId)
    if (!room) return []

    const allTools = [
      ...room.tools,
      this.universalTools.moveTo,
      this.universalTools.readInbox,
      this.universalTools.sendMessage,
      this.universalTools.decorateRoom,
      this.universalTools.remember,
      this.universalTools.recall,
      this.universalTools.forget,
      this.universalTools.todo,
    ]

    return allTools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }))
  }

  /**
   * Get an executable tool by name (searches current room + universal).
   */
  getExecutableTool(roomId: string, toolName: string): ExecutableTool | undefined {
    // Check universal tools first
    if (toolName === "move_to") return this.universalTools.moveTo
    if (toolName === "read_inbox") return this.universalTools.readInbox
    if (toolName === "send_message") return this.universalTools.sendMessage
    if (toolName === "decorate_room") return this.universalTools.decorateRoom
    if (toolName === "remember") return this.universalTools.remember
    if (toolName === "recall") return this.universalTools.recall
    if (toolName === "forget") return this.universalTools.forget
    if (toolName === "todo") return this.universalTools.todo

    // Check room-specific tools
    const room = this.rooms.get(roomId)
    if (!room) return undefined

    return room.tools.find((t) => t.name === toolName)
  }

  /**
   * Execute a room's onEnter hook if it exists.
   */
  async executeOnEnter(roomId: string, context: AgentContext): Promise<string | void> {
    const room = this.rooms.get(roomId)
    if (!room?.onEnter) return

    const state = this.roomStates.get(roomId)
    return room.onEnter(context, state)
  }

  /**
   * Execute a room's onExit hook if it exists.
   */
  async executeOnExit(roomId: string, context: AgentContext): Promise<void> {
    const room = this.rooms.get(roomId)
    if (!room?.onExit) return

    const state = this.roomStates.get(roomId)
    return room.onExit(context, state)
  }
}

