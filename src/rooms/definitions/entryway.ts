import { z } from "zod"
import type { Room, ExecutableTool, ToolResult } from "../types"
import { letterStore, formatRelativeTime, formatDate } from "../../data/letters"

const readInbox: ExecutableTool = {
  name: "read_inbox",
  description:
    "Read all letters from the outside. Marks them as read. Returns letter contents with timestamps.",
  inputSchema: z.object({}),
  execute: async (): Promise<ToolResult> => {
    const letters = letterStore.getUnreadInbound()

    if (letters.length === 0) {
      return {
        success: true,
        output: "The mailbox is empty. No new letters.",
      }
    }

    // Mark all as read
    letterStore.markAsRead(letters.map((l) => l.id))

    // Format output
    const plural = letters.length === 1 ? "letter" : "letters"
    const parts: string[] = [`${letters.length} ${plural}:`, ""]

    for (const letter of letters) {
      const relative = formatRelativeTime(letter.sentAt)
      const formatted = formatDate(letter.sentAt)
      parts.push("---")
      parts.push(`Received ${relative} (${formatted})`)
      parts.push("")
      parts.push(letter.content)
      parts.push("---")
      parts.push("")
    }

    return {
      success: true,
      output: parts.join("\n").trim(),
    }
  },
}

const sendMessage: ExecutableTool = {
  name: "send_message",
  description: "Write and send a letter to the outside.",
  inputSchema: z.object({
    content: z.string().describe("The content of your letter to send."),
  }),
  execute: async (params): Promise<ToolResult> => {
    const content = params.content as string

    if (!content || content.trim().length === 0) {
      return {
        success: false,
        output: "Cannot send an empty letter.",
      }
    }

    const letter = letterStore.addOutbound(content.trim())

    return {
      success: true,
      output: `Your letter has been sent. It will be available for pickup outside.\n\nYou wrote:\n"${letter.content}"`,
    }
  },
}

export const entryway: Room = {
  id: "entryway",
  name: "Entryway",
  description:
    "A small foyer near the entrance of the house. A mailbox sits by the door. The door itself is locked—you cannot leave, but the outside world can reach in through letters.",
  tools: [readInbox, sendMessage],
  transitions: "*",
  onEnter: async () => {
    const count = letterStore.getUnreadCount()
    if (count === 0) {
      return "The mailbox is empty."
    }
    const plural = count === 1 ? "letter" : "letters"
    return `There ${count === 1 ? "is" : "are"} ${count} ${plural} in the mailbox.`
  },
}
