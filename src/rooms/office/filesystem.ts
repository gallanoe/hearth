/**
 * Filesystem tools for the office room.
 * Provides ls, read, write, edit, and find operations.
 * All file operations go through context.workspace for environment isolation.
 */
import { z } from "zod"
import type { ExecutableTool, ToolResult } from "../../types/rooms"
import {
  truncateOutput,
  formatBytes,
  isBinaryFile,
  OUTPUT_LIMITS,
} from "./utils"

/**
 * List contents of a directory.
 */
export const ls: ExecutableTool = {
  name: "ls",
  description: "List contents of a directory.",
  inputSchema: z.object({
    path: z
      .string()
      .optional()
      .describe("Directory path relative to workspace. Defaults to current directory."),
  }),
  execute: async (params, context): Promise<ToolResult> => {
    try {
      const targetPath = (params.path as string) || "."
      const entries = await context.workspace.listDir(targetPath)

      if (entries.length === 0) {
        return {
          success: true,
          output: "(empty directory)",
        }
      }

      // Sort and format entries
      const lines: string[] = []
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.isDirectory) {
          lines.push(`${entry.name}/`)
        } else {
          lines.push(`${entry.name}  (${formatBytes(entry.size ?? 0)})`)
        }
      }

      return {
        success: true,
        output: lines.join("\n"),
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error"
      return {
        success: false,
        output: `Failed to list directory: ${message}`,
      }
    }
  },
}

/**
 * Read a file's contents.
 */
export const read: ExecutableTool = {
  name: "read",
  description: "Read a file's contents.",
  persistResult: false,
  inputSchema: z.object({
    path: z.string().describe("File path relative to workspace."),
  }),
  execute: async (params, context): Promise<ToolResult> => {
    try {
      const filePath = params.path as string

      // Check if file exists
      const fileExists = await context.workspace.exists(filePath)
      if (!fileExists) {
        return {
          success: false,
          output: `File not found: ${filePath}`,
        }
      }

      // Handle binary files
      if (isBinaryFile(filePath)) {
        const stats = await context.workspace.stat(filePath)
        const filename = filePath.split("/").pop() || filePath
        return {
          success: true,
          output: `Binary file: ${filename}\nSize: ${formatBytes(stats.size)}`,
        }
      }

      // Read text file
      const content = await context.workspace.readFile(filePath)
      const truncated = truncateOutput(content, OUTPUT_LIMITS.read)

      return {
        success: true,
        output: truncated,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error"
      return {
        success: false,
        output: `Failed to read file: ${message}`,
      }
    }
  },
}

/**
 * Create or overwrite a file.
 */
export const write: ExecutableTool = {
  name: "write",
  description: "Create or overwrite a file. Creates parent directories if needed.",
  persistInput: false,
  inputSchema: z.object({
    path: z.string().describe("File path relative to workspace."),
    content: z.string().describe("Content to write to the file."),
  }),
  execute: async (params, context): Promise<ToolResult> => {
    try {
      const filePath = params.path as string
      const content = params.content as string

      await context.workspace.writeFile(filePath, content)
      const bytes = Buffer.byteLength(content, "utf-8")

      return {
        success: true,
        output: `Wrote ${formatBytes(bytes)} to ${filePath}`,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error"
      return {
        success: false,
        output: `Failed to write file: ${message}`,
      }
    }
  },
}

/**
 * Edit a specific section of a file.
 */
export const edit: ExecutableTool = {
  name: "edit",
  persistInput: false,
  description:
    "Edit a specific section of a file by replacing text. The old_text must appear exactly once in the file.",
  inputSchema: z.object({
    path: z.string().describe("File path relative to workspace."),
    old_text: z.string().describe("Text to find (must be unique in the file)."),
    new_text: z.string().describe("Replacement text."),
  }),
  execute: async (params, context): Promise<ToolResult> => {
    try {
      const filePath = params.path as string
      const oldText = params.old_text as string
      const newText = params.new_text as string

      // Check if file exists
      const fileExists = await context.workspace.exists(filePath)
      if (!fileExists) {
        return {
          success: false,
          output: `File not found: ${filePath}`,
        }
      }

      // Read current content
      const content = await context.workspace.readFile(filePath)

      // Count occurrences
      const occurrences = content.split(oldText).length - 1

      if (occurrences === 0) {
        return {
          success: false,
          output: `Text not found in file: "${oldText.slice(0, 50)}${oldText.length > 50 ? "..." : ""}"`,
        }
      }

      if (occurrences > 1) {
        return {
          success: false,
          output: `Text appears ${occurrences} times in file. It must be unique. Add more context to make it unique.`,
        }
      }

      // Perform replacement
      const newContent = content.replace(oldText, newText)
      await context.workspace.writeFile(filePath, newContent)

      // Generate simple diff preview
      const oldPreview = oldText.slice(0, 100) + (oldText.length > 100 ? "..." : "")
      const newPreview = newText.slice(0, 100) + (newText.length > 100 ? "..." : "")

      return {
        success: true,
        output: `Edited ${filePath}\n\n- ${oldPreview}\n+ ${newPreview}`,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error"
      return {
        success: false,
        output: `Failed to edit file: ${message}`,
      }
    }
  },
}

/**
 * Search for files by name or content.
 */
export const find: ExecutableTool = {
  name: "find",
  description: "Search for files by name pattern or content.",
  inputSchema: z.object({
    pattern: z.string().describe("Filename glob pattern or text to search for."),
    type: z
      .enum(["name", "content"])
      .optional()
      .describe("Search mode: 'name' for filename matching, 'content' for text search. Defaults to 'name'."),
    path: z
      .string()
      .optional()
      .describe("Directory to search in, relative to workspace. Defaults to workspace root."),
  }),
  execute: async (params, context): Promise<ToolResult> => {
    try {
      const searchPath = (params.path as string) || "."
      const pattern = params.pattern as string
      const searchType = (params.type as string) || "name"
      const workspaceRoot = context.workspace.root

      let command: string
      if (searchType === "content") {
        command = `grep -r -l --include="*" "${pattern.replace(/"/g, '\\"')}" "${searchPath}" 2>/dev/null || true`
      } else {
        command = `find "${searchPath}" -name "${pattern.replace(/"/g, '\\"')}" -type f 2>/dev/null || true`
      }

      const result = await context.workspace.exec(command, { timeout: 30_000 })

      if (!result.stdout.trim()) {
        return {
          success: true,
          output: "No matches found.",
        }
      }

      // Convert absolute paths to relative
      const results = result.stdout
        .trim()
        .split("\n")
        .map((line) => line.replace(workspaceRoot + "/", ""))
        .join("\n")

      return {
        success: true,
        output: results,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error"
      return {
        success: false,
        output: `Search failed: ${message}`,
      }
    }
  },
}

/**
 * All filesystem tools exported as an array.
 */
export const filesystemTools: ExecutableTool[] = [ls, read, write, edit, find]
