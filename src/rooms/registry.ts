import { z } from "zod"
import type { Room, ExecutableTool, AgentContext, ToolResult, UniversalTools } from "./types"
import type { ToolDefinition } from "../llm/types"

/**
 * Registry for all rooms in the house.
 * Handles room lookup, navigation validation, and tool resolution.
 */
export class RoomRegistry {
  private rooms: Map<string, Room> = new Map()
  private roomStates: Map<string, Record<string, unknown>> = new Map()
  private universalTools: UniversalTools

  constructor() {
    this.universalTools = this.createUniversalTools()
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
      this.universalTools.checkBudget,
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
    if (toolName === "check_budget") return this.universalTools.checkBudget

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

  /**
   * Create the universal tools available in all rooms.
   */
  private createUniversalTools(): UniversalTools {
    const registry = this

    const moveTo: ExecutableTool = {
      name: "move_to",
      description: "Move to another room in the house.",
      inputSchema: z.object({
        room: z.string().describe("The ID of the room to move to"),
      }),
      execute: async (params, context): Promise<ToolResult> => {
        const targetRoom = params.room as string

        if (!registry.canTransition(context.currentRoom, targetRoom)) {
          const room = registry.get(context.currentRoom)
          const availableRooms = room?.transitions === "*"
            ? registry.getAllRoomIds().filter((id) => id !== context.currentRoom)
            : room?.transitions ?? []

          return {
            success: false,
            output: `Cannot move to "${targetRoom}" from here. Available rooms: ${availableRooms.join(", ")}`,
          }
        }

        // Signal the move (actual transition handled by loop)
        context.signals.requestedMove = targetRoom

        const targetRoomDef = registry.get(targetRoom)
        return {
          success: true,
          output: `Moving to ${targetRoomDef?.name ?? targetRoom}...`,
        }
      },
    }

    const checkBudget: ExecutableTool = {
      name: "check_budget",
      description: "Check how much of today's token budget remains.",
      inputSchema: z.object({}),
      execute: async (_params, context): Promise<ToolResult> => {
        const { total, spent, remaining, warningThreshold } = context.budget
        const percentRemaining = Math.round((remaining / total) * 100)
        const isLow = remaining <= warningThreshold

        let output = `Budget status: ${remaining.toLocaleString()} tokens remaining (${percentRemaining}% of daily budget).`
        if (isLow) {
          output += ` Warning: Budget is low. Consider wrapping up and heading to bed.`
        }

        return { success: true, output }
      },
    }

    return { moveTo, checkBudget }
  }
}

/**
 * Singleton registry instance.
 */
export const roomRegistry = new RoomRegistry()