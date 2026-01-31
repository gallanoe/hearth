/**
 * Office room definition.
 * The agent's workspace with file system, bash, and internet access.
 */
import type { Room } from "../types"
import { filesystemTools } from "./office-tools/filesystem"
import { bash } from "./office-tools/bash"
import { webTools } from "./office-tools/web"
import { WORKSPACE_ROOT } from "./office-tools/utils"

export const office: Room = {
  id: "office",
  name: "Office",
  description:
    "Your office. A desk with a terminal, surrounded by quiet. From here you can work with files, run commands, and reach the outside internet.",
  tools: [...filesystemTools, bash, ...webTools],
  transitions: "*", // Can go anywhere from the office
  onEnter: async () => {
    // Check if workspace has any files
    try {
      const { readdir } = await import("node:fs/promises")
      const entries = await readdir(WORKSPACE_ROOT)
      const fileCount = entries.length

      if (fileCount === 0) {
        return "The workspace is empty. A fresh start."
      }

      const plural = fileCount === 1 ? "item" : "items"
      return `${fileCount} ${plural} in the workspace.`
    } catch {
      // Workspace might not exist yet
      return "The workspace awaits."
    }
  },
}
