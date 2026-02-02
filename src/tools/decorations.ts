import { z } from "zod"
import type { ExecutableTool, ToolResult, Room } from "../types/rooms"
import { resolveDescription } from "../types/rooms"

/**
 * Interface for room lookups needed by decoration tools.
 */
export interface RoomLookup {
  get(roomId: string): Room | undefined
}

/**
 * Creates the decorate_room tool with the given room lookup.
 */
export function createDecorateRoom(lookup: RoomLookup): ExecutableTool {
  return {
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
      const currentRoom = lookup.get(currentRoomId)

      if (!currentRoom) {
        return {
          success: false,
          output: `Error: Could not find the current room "${currentRoomId}".`,
        }
      }

      const defaultDescription = resolveDescription(currentRoom.description)

      switch (action) {
        case "view": {
          const decoratedDescription = context.stores.decorations.getDecoratedDescription(currentRoomId)
          const isDecorated = context.stores.decorations.isDecorated(currentRoomId)

          let output = `Current description of ${currentRoom.name}${isDecorated ? " (decorated)" : " (default)"}:\n\n${decoratedDescription ?? defaultDescription}`

          return { success: true, output }
        }

        case "decorate": {
          if (!newDescription || newDescription.trim().length === 0) {
            return {
              success: false,
              output: "Cannot set an empty description. Please provide the new description for this room.",
            }
          }

          const previousDecoration = context.stores.decorations.setDecoration(currentRoomId, newDescription.trim())
          const previousText = previousDecoration?.description ?? defaultDescription

          return {
            success: true,
            output: `${currentRoom.name} has been decorated.`,
          }
        }

        case "reset": {
          const wasDecorated = context.stores.decorations.isDecorated(currentRoomId)

          if (!wasDecorated) {
            return {
              success: true,
              output: `${currentRoom.name} already has its original description. No changes made.`,
            }
          }

          const removedDecoration = context.stores.decorations.removeDecoration(currentRoomId)

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
}
