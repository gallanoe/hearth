import type { Room, ExecutableTool, AgentContext, UniversalTools } from "../types/rooms"
import { resolveDescription } from "../types/rooms"
import type { ToolDefinition } from "../types/llm"
import type { RoomDecorationStore } from "../data/decorations"
import { createMoveTo } from "../tools/navigation"
import { readInbox, sendMessage } from "../tools/communication"
import { createDecorateRoom } from "../tools/decorations"
import { remember, recall, forget } from "../tools/memory"
import { todo } from "../tools/todo"
import { createExecuteRoomTool, createGetRoomToolDef } from "../tools/room-dispatch"

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
      executeRoomTool: createExecuteRoomTool(this),
      getRoomToolDef: createGetRoomToolDef(this),
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
   * The fixed set of tool definitions sent to the LLM on every turn.
   *
   * This is fully static and room-independent: the two dispatch wrappers
   * (execute_room_tool, get_room_tool_def) plus the universal tools. Room-specific
   * tools are NOT included — they're reached through execute_room_tool. Because
   * tools sit at the front of the prompt-cache prefix (before system + messages),
   * keeping this list constant means a room transition never invalidates the
   * cache. Room tools are resolved on demand via {@link getRoomToolDefinition}.
   */
  getStaticToolDefinitions(): ToolDefinition[] {
    const tools: ExecutableTool[] = [
      this.universalTools.executeRoomTool,
      this.universalTools.getRoomToolDef,
      this.universalTools.moveTo,
      this.universalTools.readInbox,
      this.universalTools.sendMessage,
      this.universalTools.decorateRoom,
      this.universalTools.remember,
      this.universalTools.recall,
      this.universalTools.forget,
      this.universalTools.todo,
    ]

    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }))
  }

  /**
   * The LLM-facing definition of a single room-specific tool, or undefined if the
   * room doesn't define it. Backs the get_room_tool_def wrapper: since room tool
   * defs aren't sent up front (see {@link getStaticToolDefinitions}), the agent
   * fetches them one at a time. Excludes universal tools, which are sent natively.
   */
  getRoomToolDefinition(roomId: string, toolName: string): ToolDefinition | undefined {
    const tool = this.getRoomExecutableTool(roomId, toolName)
    if (!tool) return undefined
    return {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }
  }

  /**
   * Get an executable tool by name (searches current room + universal).
   */
  getExecutableTool(roomId: string, toolName: string): ExecutableTool | undefined {
    // Check the static dispatch + universal tools first
    if (toolName === "execute_room_tool") return this.universalTools.executeRoomTool
    if (toolName === "get_room_tool_def") return this.universalTools.getRoomToolDef
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
   * The executable room-specific tool of the given name in a room, or undefined.
   * Unlike {@link getExecutableTool} this never returns a universal/dispatch tool,
   * so the execute_room_tool wrapper can't be tricked into re-dispatching to a
   * universal tool (those are called natively).
   */
  getRoomExecutableTool(roomId: string, toolName: string): ExecutableTool | undefined {
    return this.rooms.get(roomId)?.tools.find((t) => t.name === toolName)
  }

  /**
   * The tool whose persistInput/persistResult flags govern a given tool call.
   *
   * For a direct call it's just that tool. For an execute_room_tool envelope it's
   * the inner room tool being dispatched — so opt-outs like bash's
   * `persistResult: false` or write's `persistInput: false` are still honored even
   * though the loop only sees the wrapper. Returns undefined if the inner tool
   * can't be resolved (e.g. a malformed envelope).
   */
  getToolForPersistence(
    roomId: string,
    toolName: string,
    args: Record<string, unknown>
  ): ExecutableTool | undefined {
    if (toolName === "execute_room_tool") {
      const inner = args.tool_name
      return typeof inner === "string" ? this.getRoomExecutableTool(roomId, inner) : undefined
    }
    return this.getExecutableTool(roomId, toolName)
  }

  /**
   * Names of the rooms that define a given room-specific tool. Empty if no room
   * defines it (i.e. it's unknown, or a universal tool). The LLM is sent the full
   * tool set regardless of room (for cache stability), so when it calls a tool
   * that {@link getExecutableTool} can't resolve in the current room, this tells
   * it where that tool actually lives.
   */
  getRoomsForTool(toolName: string): string[] {
    const names: string[] = []
    for (const room of this.rooms.values()) {
      if (room.tools.some((t) => t.name === toolName)) {
        names.push(room.name)
      }
    }
    return names
  }

  /**
   * The names of the room-specific tools defined by a single room (excludes the
   * universal tools). Empty for an unknown room or one with no tools. The set
   * advertised to the LLM is room-independent (see
   * {@link getStaticToolDefinitions}); these are the tools reachable via
   * execute_room_tool here, recorded in trace metadata as `roomTools` so a turn
   * shows what the current room actually offered.
   */
  getRoomToolNames(roomId: string): string[] {
    return this.rooms.get(roomId)?.tools.map((t) => t.name) ?? []
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

