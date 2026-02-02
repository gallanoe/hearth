import { z } from "zod"
import type { ExecutableTool, ToolResult } from "../types/rooms"
import { formatRelativeTime, formatDate } from "../data/letters"

/**
 * Read all letters from the outside.
 */
export const readInbox: ExecutableTool = {
  name: "read_inbox",
  description:
    "Read all letters from the outside. Marks them as read. Returns letter contents with timestamps.",
  inputSchema: z.object({}),
  execute: async (_params, context): Promise<ToolResult> => {
    const letters = context.stores.letters.getUnreadInbound()

    if (letters.length === 0) {
      return {
        success: true,
        output: "The mailbox is empty. No new letters.",
      }
    }

    // Mark all as read
    context.stores.letters.markAsRead(letters.map((l) => l.id))

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

/**
 * Write and send a letter to the outside.
 */
export const sendMessage: ExecutableTool = {
  name: "send_message",
  description: "Write and send a letter to the outside.",
  inputSchema: z.object({
    content: z.string().describe("The content of your letter to send."),
  }),
  execute: async (params, context): Promise<ToolResult> => {
    const content = params.content as string

    if (!content || content.trim().length === 0) {
      return {
        success: false,
        output: "Cannot send an empty letter.",
      }
    }

    context.stores.letters.addOutbound(content.trim())

    return {
      success: true,
      output: `Your letter has been sent.`,
    }
  },
}
