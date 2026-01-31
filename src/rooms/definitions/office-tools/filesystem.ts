/**
 * Filesystem tools for the office room.
 * Provides ls, read, write, edit, and find operations.
 */
import { z } from "zod"
import { readdir, stat, mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import type { ExecutableTool, ToolResult } from "../../types"
import {
  resolvePath,
  truncateOutput,
  formatBytes,
  formatDate,
  isBinaryFile,
  getFileMetadata,
  OUTPUT_LIMITS,
  WORKSPACE_ROOT,
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
  execute: async (params): Promise<ToolResult> => {
    try {
      const targetPath = resolvePath((params.path as string) || ".")
      const entries = await readdir(targetPath, { withFileTypes: true })

      if (entries.length === 0) {
        return {
          success: true,
          output: "(empty directory)",
        }
      }

      // Get stats for each entry
      const lines: string[] = []
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        const entryPath = join(targetPath, entry.name)
        try {
          const stats = await stat(entryPath)
          if (entry.isDirectory()) {
            lines.push(`${entry.name}/`)
          } else {
            lines.push(`${entry.name}  (${formatBytes(stats.size)})`)
          }
        } catch {
          // If we can't stat, just show the name
          lines.push(entry.name)
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
  inputSchema: z.object({
    path: z.string().describe("File path relative to workspace."),
  }),
  execute: async (params): Promise<ToolResult> => {
    try {
      const filePath = resolvePath(params.path as string)

      // Check if file exists
      const file = Bun.file(filePath)
      const exists = await file.exists()
      if (!exists) {
        return {
          success: false,
          output: `File not found: ${params.path}`,
        }
      }

      // Handle binary files
      if (isBinaryFile(filePath)) {
        const metadata = await getFileMetadata(filePath)
        return {
          success: true,
          output: metadata,
        }
      }

      // Read text file
      const content = await file.text()
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
  inputSchema: z.object({
    path: z.string().describe("File path relative to workspace."),
    content: z.string().describe("Content to write to the file."),
  }),
  execute: async (params): Promise<ToolResult> => {
    try {
      const filePath = resolvePath(params.path as string)
      const content = params.content as string

      // Create parent directories if needed
      const dir = dirname(filePath)
      await mkdir(dir, { recursive: true })

      // Write file
      await Bun.write(filePath, content)
      const bytes = Buffer.byteLength(content, "utf-8")

      return {
        success: true,
        output: `Wrote ${formatBytes(bytes)} to ${params.path}`,
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
  description:
    "Edit a specific section of a file by replacing text. The old_text must appear exactly once in the file.",
  inputSchema: z.object({
    path: z.string().describe("File path relative to workspace."),
    old_text: z.string().describe("Text to find (must be unique in the file)."),
    new_text: z.string().describe("Replacement text."),
  }),
  execute: async (params): Promise<ToolResult> => {
    try {
      const filePath = resolvePath(params.path as string)
      const oldText = params.old_text as string
      const newText = params.new_text as string

      // Check if file exists
      const file = Bun.file(filePath)
      const exists = await file.exists()
      if (!exists) {
        return {
          success: false,
          output: `File not found: ${params.path}`,
        }
      }

      // Read current content
      const content = await file.text()

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
      await Bun.write(filePath, newContent)

      // Generate simple diff preview
      const oldPreview = oldText.slice(0, 100) + (oldText.length > 100 ? "..." : "")
      const newPreview = newText.slice(0, 100) + (newText.length > 100 ? "..." : "")

      return {
        success: true,
        output: `Edited ${params.path}\n\n- ${oldPreview}\n+ ${newPreview}`,
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
  execute: async (params): Promise<ToolResult> => {
    try {
      const searchPath = resolvePath((params.path as string) || ".")
      const pattern = params.pattern as string
      const searchType = (params.type as string) || "name"

      let command: string
      if (searchType === "content") {
        // Use grep for content search
        command = `grep -r -l --include="*" "${pattern.replace(/"/g, '\\"')}" "${searchPath}" 2>/dev/null || true`
      } else {
        // Use find for name search
        command = `find "${searchPath}" -name "${pattern.replace(/"/g, '\\"')}" -type f 2>/dev/null || true`
      }

      const proc = Bun.spawn(["bash", "-c", command], {
        cwd: WORKSPACE_ROOT,
        timeout: 30_000,
      })

      const stdout = await new Response(proc.stdout).text()
      await proc.exited

      if (!stdout.trim()) {
        return {
          success: true,
          output: "No matches found.",
        }
      }

      // Convert absolute paths to relative
      const results = stdout
        .trim()
        .split("\n")
        .map((line) => line.replace(WORKSPACE_ROOT + "/", ""))
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
