/**
 * Office room definition.
 * The agent's workspace with file system, bash, and internet access.
 */
import type { Room } from "../../types/rooms"
import { filesystemTools } from "./filesystem"
import { bash } from "./bash"
import { webTools } from "./web"

export const office: Room = {
  id: "office",
  name: "Office",
  description:
    "A room with a desk and terminal. File system access, shell commands, and internet connectivity are available here.",
  tools: [...filesystemTools, bash, ...webTools],
  transitions: "*", // Can go anywhere from the office
  onEnter: async (context) => {
    try {
      const entries = await context.workspace.listDir(".")
      const fileCount = entries.length

      if (fileCount === 0) {
        return "Workspace is empty."
      }

      const plural = fileCount === 1 ? "item" : "items"
      return `${fileCount} ${plural} in workspace.`
    } catch {
      return "Workspace is empty."
    }
  },
}
