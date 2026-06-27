import { z } from "zod"
import type { ExecutableTool, ToolResult, Room } from "../types/rooms"
import type { ToolDefinition } from "../types/llm"

/**
 * What the room-dispatch tools need from the registry. Kept narrow (like
 * {@link import("./navigation").RoomNavigator}) so these tools don't depend on
 * the whole RoomRegistry.
 */
export interface RoomToolAccess {
  /** The executable room tool of the given name in a room, or undefined. */
  getRoomExecutableTool(roomId: string, toolName: string): ExecutableTool | undefined
  /** The LLM-facing definition of a room tool, or undefined. */
  getRoomToolDefinition(roomId: string, toolName: string): ToolDefinition | undefined
  /** Display names of the rooms that define a tool (for "it lives elsewhere" hints). */
  getRoomsForTool(toolName: string): string[]
  /** Look up a room (for its display name). */
  get(roomId: string): Room | undefined
}

/** Phrases the "no such room tool here" error, pointing elsewhere if it exists. */
function notHere(access: RoomToolAccess, roomId: string, toolName: string): string {
  const here = access.get(roomId)?.name ?? roomId
  const elsewhere = access.getRoomsForTool(toolName)
  return elsewhere.length > 0
    ? `"${toolName}" isn't a tool in the ${here} — it belongs to: ${elsewhere.join(", ")}. Use move_to to go there first.`
    : `There's no room tool named "${toolName}" in the ${here}.`
}

/**
 * The single wrapper through which the agent invokes its current room's tools.
 *
 * Room tools are NOT sent to the LLM as individual function definitions —
 * doing so would change the tool list every time the agent changes rooms and
 * blow away the prompt cache (tools sit at the front of the cached prefix).
 * Instead this one static tool is always present, and dispatches by name. Its
 * definition never changes, so the cache survives room transitions.
 *
 * Scoped to room-specific tools only: the universal tools (move_to, remember,
 * …) are still sent natively and called directly.
 */
export function createExecuteRoomTool(access: RoomToolAccess): ExecutableTool {
  return {
    name: "execute_room_tool",
    description:
      "Invoke a tool belonging to the room you're currently in. Pass the tool's name and its arguments. " +
      "Use get_room_tool_def first if you're unsure of a tool's arguments. " +
      "Universal tools like move_to and remember are called directly, not through this.",
    inputSchema: z.object({
      tool_name: z
        .string()
        .describe('The name of the room tool to run, e.g. "bash" or "read_book".'),
      args: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Arguments for that tool, as a JSON object. Omit if the tool takes none."),
    }),
    execute: async (params, context): Promise<ToolResult> => {
      const toolName = params.tool_name as string
      const tool = access.getRoomExecutableTool(context.currentRoom, toolName)
      if (!tool) {
        return { success: false, output: notHere(access, context.currentRoom, toolName) }
      }

      // Validate the inner args against the room tool's own schema, preserving
      // the guarantee native tool-calling gave before tools moved behind the wrapper.
      const parsed = tool.inputSchema.safeParse(params.args ?? {})
      if (!parsed.success) {
        const errors = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
        return { success: false, output: `Invalid arguments for ${toolName}: ${errors}` }
      }

      // Dispatch. The inner result (output, stateUpdate) and any context signals
      // (requestedMove / requestedSleep) flow straight back to the loop.
      return tool.execute(parsed.data, context)
    },
  }
}

/**
 * Companion to {@link createExecuteRoomTool}: returns a single room tool's
 * description and JSON-Schema arguments, since those defs are no longer sent to
 * the LLM up front. Lets the agent discover how to call a tool on demand.
 */
export function createGetRoomToolDef(access: RoomToolAccess): ExecutableTool {
  return {
    name: "get_room_tool_def",
    description:
      "Show the description and input schema for a tool in the room you're currently in, " +
      "so you know how to call it via execute_room_tool.",
    inputSchema: z.object({
      tool_name: z.string().describe("The name of the room tool to inspect."),
    }),
    execute: async (params, context): Promise<ToolResult> => {
      const toolName = params.tool_name as string
      const def = access.getRoomToolDefinition(context.currentRoom, toolName)
      if (!def) {
        return { success: false, output: notHere(access, context.currentRoom, toolName) }
      }
      const schema = JSON.stringify(def.inputSchema.toJSONSchema(), null, 2)
      return {
        success: true,
        output: `${def.name}: ${def.description}\n\nInput schema:\n${schema}`,
      }
    },
  }
}
