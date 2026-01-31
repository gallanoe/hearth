/**
 * Shared utilities for office tools.
 */
import { resolve, join } from "node:path"
import { stat } from "node:fs/promises"

/**
 * The agent's workspace root directory.
 * All file operations are scoped to this directory.
 */
export const WORKSPACE_ROOT = process.env.AGENT_WORKSPACE || "/home/agent"

/**
 * Output limits for different tools.
 */
export const OUTPUT_LIMITS = {
  bash: 10_000,
  read: 50_000,
  fetch: 50_000,
} as const

/**
 * Default timeout for commands and fetches.
 */
export const DEFAULT_TIMEOUT = 30_000

/**
 * Resolves a user-provided path to an absolute path within the workspace.
 * Throws if the resolved path would escape the workspace.
 */
export function resolvePath(userPath: string): string {
  // Handle empty or "." path
  const normalizedPath = userPath?.trim() || "."
  
  // Resolve to absolute path relative to workspace
  const resolved = resolve(WORKSPACE_ROOT, normalizedPath)
  
  // Security check: ensure we're still within workspace
  if (!resolved.startsWith(WORKSPACE_ROOT)) {
    throw new Error("Access denied: path outside workspace")
  }
  
  return resolved
}

/**
 * Truncates output with a notice if it exceeds the limit.
 */
export function truncateOutput(output: string, limit: number): string {
  if (output.length <= limit) {
    return output
  }
  
  const truncated = output.slice(0, limit)
  return `${truncated}\n\n--- truncated (showing ${limit.toLocaleString()} of ${output.length.toLocaleString()} characters) ---`
}

/**
 * Formats bytes into human-readable string.
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  
  const units = ["B", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  const value = bytes / Math.pow(1024, i)
  
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

/**
 * Formats a date for display.
 */
export function formatDate(date: Date): string {
  return date.toISOString().replace("T", " ").slice(0, 16)
}

/**
 * Common binary file extensions.
 */
const BINARY_EXTENSIONS = new Set([
  // Images
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".svg",
  // Audio/Video
  ".mp3", ".mp4", ".wav", ".ogg", ".webm", ".avi", ".mov",
  // Archives
  ".zip", ".tar", ".gz", ".rar", ".7z",
  // Documents
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  // Executables
  ".exe", ".dll", ".so", ".dylib",
  // Other
  ".bin", ".dat", ".db", ".sqlite",
])

/**
 * Checks if a file is likely binary based on extension.
 */
export function isBinaryFile(filePath: string): boolean {
  const ext = filePath.toLowerCase().slice(filePath.lastIndexOf("."))
  return BINARY_EXTENSIONS.has(ext)
}

/**
 * Gets a simple mime type description based on extension.
 */
export function getMimeType(filePath: string): string {
  const ext = filePath.toLowerCase().slice(filePath.lastIndexOf("."))
  
  const mimeTypes: Record<string, string> = {
    // Images
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    // Audio
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    // Video
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".avi": "video/x-msvideo",
    ".mov": "video/quicktime",
    // Archives
    ".zip": "application/zip",
    ".tar": "application/x-tar",
    ".gz": "application/gzip",
    // Documents
    ".pdf": "application/pdf",
    // Data
    ".json": "application/json",
    ".xml": "application/xml",
    ".db": "application/x-sqlite3",
    ".sqlite": "application/x-sqlite3",
  }
  
  return mimeTypes[ext] || "application/octet-stream"
}

/**
 * Gets file metadata for binary file display.
 */
export async function getFileMetadata(filePath: string): Promise<string> {
  const stats = await stat(filePath)
  const filename = filePath.split("/").pop() || filePath
  const mimeType = getMimeType(filePath)
  const modified = formatDate(stats.mtime)
  
  return `Binary file: ${filename}
Type: ${mimeType}
Size: ${formatBytes(stats.size)}
Modified: ${modified}`
}
