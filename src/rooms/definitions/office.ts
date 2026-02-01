/**
 * Office room definition.
 * The agent's workspace with file system, bash, and internet access.
 */
import type { Room } from "../types"
import { filesystemTools } from "./office-tools/filesystem"
import { bash } from "./office-tools/bash"
import { webTools } from "./office-tools/web"
import { WORKSPACE_ROOT, ensureWorkspaceExists } from "./office-tools/utils"

export const office: Room = {
  id: "office",
  name: "Office",
  description:
    "A room with a desk and terminal. File system access, shell commands, and internet connectivity are available here.",
  tools: [...filesystemTools, bash, ...webTools],
  transitions: "*", // Can go anywhere from the office
  onEnter: async () => {
    // Ensure workspace directory exists
    await ensureWorkspaceExists()

    // Check if workspace has any files
    const { readdir } = await import("node:fs/promises")
    const entries = await readdir(WORKSPACE_ROOT)
    const fileCount = entries.length

    if (fileCount === 0) {
      return "Workspace is empty."
    }

    const plural = fileCount === 1 ? "item" : "items"
    return `${fileCount} ${plural} in workspace.`
  },
}
