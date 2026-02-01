import { z } from "zod"
import type { Room, ExecutableTool, AgentContext, ToolResult, UniversalTools } from "./types"
import type { ToolDefinition } from "../llm/types"
import { letterStore, formatRelativeTime, formatDate } from "../data/letters"
import { roomDecorationStore } from "../data/decorations"

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
   * Get the effective description for a room (decorated or default).
   */
  getRoomDescription(roomId: string): string | undefined {
    const room = this.rooms.get(roomId)
    if (!room) return undefined

    // Return decorated description if set, otherwise default
    return roomDecorationStore.getDecoratedDescription(roomId) ?? room.description
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
      this.universalTools.readInbox,
      this.universalTools.sendMessage,
      this.universalTools.decorateRoom,
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
    if (toolName === "read_inbox") return this.universalTools.readInbox
    if (toolName === "send_message") return this.universalTools.sendMessage
    if (toolName === "decorate_room") return this.universalTools.decorateRoom

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

    const readInbox: ExecutableTool = {
      name: "read_inbox",
      description:
        "Read all letters from the outside. Marks them as read. Returns letter contents with timestamps.",
      inputSchema: z.object({}),
      execute: async (): Promise<ToolResult> => {
        const letters = letterStore.getUnreadInbound()

        if (letters.length === 0) {
          return {
            success: true,
            output: "The mailbox is empty. No new letters.",
          }
        }

        // Mark all as read
        letterStore.markAsRead(letters.map((l) => l.id))

        // Format output
        const plural = letters.length === 1 ? "letter" : "letters"
        const parts: string[] = [`${letters.length} ${plural}:`, ""]

        for (const letter of letters) {
          const relative = formatRelativeTime(letter.sentAt)
          const formatted = formatDate(letter.sentAt)
          parts.push("---")
          parts.push(`Received ${relative} (${formatted})`)
          parts.push("")
          parts.push(letter.content)
          parts.push("---")
          parts.push("")
        }

        return {
          success: true,
          output: parts.join("\n").trim(),
        }
      },
    }

    const sendMessage: ExecutableTool = {
      name: "send_message",
      description: "Write and send a letter to the outside.",
      inputSchema: z.object({
        content: z.string().describe("The content of your letter to send."),
      }),
      execute: async (params): Promise<ToolResult> => {
        const content = params.content as string

        if (!content || content.trim().length === 0) {
          return {
            success: false,
            output: "Cannot send an empty letter.",
          }
        }

        const letter = letterStore.addOutbound(content.trim())

        return {
          success: true,
          output: `Your letter has been sent. It will be available for pickup outside.\n\nYou wrote:\n"${letter.content}"`,
        }
      },
    }

    const decorateRoom: ExecutableTool = {
      name: "decorate_room",
      description: `View or customize the description of the room you're currently in.

CONTEXT: Room descriptions are shown when you enter a room and help set the atmosphere. By decorating a room, you can personalize your space—adding details, changing the mood, or making it feel more like home.

Use action="view" to see the current room description (and whether it's been customized).
Use action="decorate" to set a new custom description for this room.
Use action="reset" to restore the room's original description.`,
      inputSchema: z.object({
        action: z
          .enum(["view", "decorate", "reset"])
          .describe("The action to perform: view current description, decorate with a new one, or reset to default."),
        newDescription: z
          .string()
          .optional()
          .describe("Required when action is 'decorate'. The new description for this room."),
      }),
      execute: async (params, context): Promise<ToolResult> => {
        const action = params.action as "view" | "decorate" | "reset"
        const newDescription = params.newDescription as string | undefined
        const currentRoomId = context.currentRoom
        const currentRoom = registry.get(currentRoomId)

        if (!currentRoom) {
          return {
            success: false,
            output: `Error: Could not find the current room "${currentRoomId}".`,
          }
        }

        const defaultDescription = currentRoom.description

        switch (action) {
          case "view": {
            const decoratedDescription = roomDecorationStore.getDecoratedDescription(currentRoomId)
            const isDecorated = roomDecorationStore.isDecorated(currentRoomId)

            let output = `Current description of ${currentRoom.name}${isDecorated ? " (decorated)" : " (default)"}:\n\n${decoratedDescription ?? defaultDescription}`

            if (isDecorated) {
              output += `\n\n---\nOriginal description for reference:\n${defaultDescription}`
            }

            return { success: true, output }
          }

          case "decorate": {
            if (!newDescription || newDescription.trim().length === 0) {
              return {
                success: false,
                output: "Cannot set an empty description. Please provide the new description for this room.",
              }
            }

            const previousDecoration = roomDecorationStore.setDecoration(currentRoomId, newDescription.trim())
            const previousText = previousDecoration?.description ?? defaultDescription

            return {
              success: true,
              output: `${currentRoom.name} has been decorated.\n\nPrevious description:\n${previousText}\n\nNew description:\n${newDescription.trim()}\n\nThis change takes effect immediately.`,
            }
          }

          case "reset": {
            const wasDecorated = roomDecorationStore.isDecorated(currentRoomId)

            if (!wasDecorated) {
              return {
                success: true,
                output: `${currentRoom.name} already has its original description. No changes made.`,
              }
            }

            const removedDecoration = roomDecorationStore.removeDecoration(currentRoomId)

            return {
              success: true,
              output: `${currentRoom.name} decoration removed.\n\nPrevious (custom) description:\n${removedDecoration?.description}\n\nOriginal description restored:\n${defaultDescription}`,
            }
          }

          default:
            return { success: false, output: `Unknown action: ${action}` }
        }
      },
    }

    return { moveTo, checkBudget, readInbox, sendMessage, decorateRoom }
  }
}

/**
 * Singleton registry instance.
 */
export const roomRegistry = new RoomRegistry()