import { z } from "zod"
import type { ExecutableTool, ToolResult } from "../types/rooms"
import { memoryStore } from "../data/memories"
import { formatRelativeTime } from "../data/letters"

export const remember: ExecutableTool = {
  name: "remember",
  description:
    "Store something in your long-term memory. Use this for facts, observations, preferences, or anything you want to recall in future sessions. Be specific and concise — write memories as self-contained notes.",
  inputSchema: z.object({
    content: z
      .string()
      .describe(
        "What to remember. Write as a standalone note (e.g., 'User enjoys chess and mentioned wanting to play more')."
      ),
    tags: z
      .array(z.string())
      .optional()
      .describe(
        "Optional tags for organization (e.g., ['books', 'moby-dick'] or ['letters', 'user-preferences'])."
      ),
  }),
  execute: async (params, context): Promise<ToolResult> => {
    const content = params.content as string
    const tags = (params.tags as string[] | undefined) ?? []

    const memory = await memoryStore.add(content, tags, context.currentSession, context.currentRoom)

    return {
      success: true,
      output: `Noted. (Memory #${memory.id}, tags: ${tags.length > 0 ? tags.join(", ") : "none"})`,
    }
  },
}

export const recall: ExecutableTool = {
  name: "recall",
  description:
    "Search your memories and past session history. Use this to find something you previously stored, or to look back at what happened in earlier sessions.",
  inputSchema: z.object({
    query: z.string().describe("What to search for."),
    scope: z
      .enum(["memories", "sessions", "all"])
      .optional()
      .describe(
        "Where to search. 'memories' = your stored notes, 'sessions' = past session summaries, 'all' = both. Default: 'all'."
      ),
    limit: z.number().optional().describe("Max results to return. Default: 5."),
  }),
  execute: async (params): Promise<ToolResult> => {
    const query = params.query as string
    const scope = (params.scope as "memories" | "sessions" | "all" | undefined) ?? "all"
    const limit = (params.limit as number | undefined) ?? 5

    const results = await memoryStore.search(query, scope, limit)

    if (results.length === 0) {
      return {
        success: true,
        output: `No matching memories found for '${query}'.`,
      }
    }

    const lines: string[] = []
    for (const result of results) {
      const relative = formatRelativeTime(result.memory.createdAt)
      if (result.source === "explicit") {
        const tagStr = result.memory.tags.length > 0 ? result.memory.tags.join(", ") : "none"
        lines.push(`[Memory #${result.memory.id}] ${result.memory.content} (tags: ${tagStr}, stored ${relative})`)
      } else {
        lines.push(`[Session] ${result.memory.content} (${relative})`)
      }
    }

    return {
      success: true,
      output: lines.join("\n\n"),
    }
  },
}

export const forget: ExecutableTool = {
  name: "forget",
  description: "Remove a specific memory by its ID. The memory is archived, not permanently destroyed.",
  inputSchema: z.object({
    memoryId: z.number().describe("The memory ID to remove (from recall results)."),
  }),
  execute: async (params): Promise<ToolResult> => {
    const memoryId = params.memoryId as number

    const removed = await memoryStore.remove(memoryId)

    if (removed) {
      return {
        success: true,
        output: `Memory #${memoryId} forgotten.`,
      }
    }

    return {
      success: false,
      output: `No active memory found with ID ${memoryId}.`,
    }
  },
}
