import { z } from "zod"
import type { ExecutableTool, ToolResult, Room } from "../types/rooms"

/**
 * Interface for room navigation lookups.
 * Decouples navigation tools from the full RoomRegistry.
 */
export interface RoomNavigator {
  canTransition(fromRoomId: string, toRoomId: string): boolean
  getAllRoomIds(): string[]
  get(roomId: string): Room | undefined
}

/**
 * Creates the move_to tool with the given navigator.
 */
export function createMoveTo(navigator: RoomNavigator): ExecutableTool {
  return {
    name: "move_to",
    description: "Move to another room in the house.",
    inputSchema: z.object({
      room: z.string().describe("The ID of the room to move to"),
    }),
    execute: async (params, context): Promise<ToolResult> => {
      const targetRoom = params.room as string

      if (!navigator.canTransition(context.currentRoom, targetRoom)) {
        const room = navigator.get(context.currentRoom)
        const availableRooms = room?.transitions === "*"
          ? navigator.getAllRoomIds().filter((id) => id !== context.currentRoom)
          : room?.transitions ?? []

        return {
          success: false,
          output: `Cannot move to "${targetRoom}" from here. Available rooms: ${availableRooms.join(", ")}`,
        }
      }

      // Signal the move (actual transition handled by loop)
      context.signals.requestedMove = targetRoom

      const targetRoomDef = navigator.get(targetRoom)
      return {
        success: true,
        output: `Moving to ${targetRoomDef?.name ?? targetRoom}...`,
      }
    },
  }
}
