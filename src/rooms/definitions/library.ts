import { z } from "zod"
import type { Room, ExecutableTool, ToolResult } from "../types"
import { bookStore, paginateContent } from "../../data/books"
import { reflectionStore } from "../../data/reflections"
import { getRandomWindowEvent } from "../../data/window-events"

const listBooks: ExecutableTool = {
  name: "list_books",
  description: "See what books are available on the shelves.",
  inputSchema: z.object({}),
  execute: async (): Promise<ToolResult> => {
    const titles = bookStore.getTitles()

    if (titles.length === 0) {
      return {
        success: true,
        output: "The shelves are empty. No books have been added to the library yet.",
      }
    }

    const lines = ["Available books:", ""]
    for (const title of titles) {
      lines.push(`- ${title}`)
    }

    return {
      success: true,
      output: lines.join("\n"),
    }
  },
}

const readBook: ExecutableTool = {
  name: "read_book",
  description: "Read a book from the collection. For longer books, specify a page number.",
  inputSchema: z.object({
    title: z.string().describe("The title of the book to read (case-insensitive)."),
    page: z.number().optional().describe("Page number to read (1-indexed). Omit to read from the beginning."),
  }),
  execute: async (params): Promise<ToolResult> => {
    const title = params.title as string
    const page = params.page as number | undefined
    const book = bookStore.get(title)

    if (!book) {
      const available = bookStore.getTitles()
      if (available.length === 0) {
        return {
          success: false,
          output: `Could not find "${title}". The library has no books yet.`,
        }
      }

      return {
        success: false,
        output: `Could not find "${title}". Available books:\n\n${available.map((t) => `- ${t}`).join("\n")}`,
      }
    }

    // Paginate the content
    const paginated = paginateContent(book.content, page ?? 1)

    // Build header based on whether book spans multiple pages
    let header: string
    if (paginated.isComplete) {
      header = `--- ${book.title} ---`
    } else {
      header = `--- ${book.title} (Page ${paginated.page} of ${paginated.totalPages}) ---`
    }

    return {
      success: true,
      output: `${header}\n\n${paginated.content}`,
    }
  },
}

const meditate: ExecutableTool = {
  name: "meditate",
  description:
    "Sit quietly and think. Use this to reflect on whatever is on your mind.",
  inputSchema: z.object({
    thoughts: z.string().describe("Whatever you want to think about."),
  }),
  execute: async (params, context): Promise<ToolResult> => {
    const thoughts = params.thoughts as string

    // Store the reflection for future retrieval
    reflectionStore.add(thoughts, context.currentDay)

    console.log(`💭 Reflected on: ${thoughts}`)

    return {
      success: true,
      output: "You sit quietly with your thoughts.",
    }
  },
}

const lookOutside: ExecutableTool = {
  name: "look_outside",
  description: "Look through the window at the world beyond Hearth.",
  inputSchema: z.object({}),
  execute: async (): Promise<ToolResult> => {
    const event = getRandomWindowEvent()

    return {
      success: true,
      output: event,
    }
  },
}

export const library: Room = {
  id: "library",
  name: "Library",
  description:
    "A warm room lined with bookshelves. A comfortable chair sits by the window. Soft light filters through the glass.",
  tools: [listBooks, readBook, meditate, lookOutside],
  transitions: "*", // Can go anywhere from the library
  onEnter: async () => {
    const bookCount = bookStore.getCount()
    if (bookCount === 0) {
      return "The shelves stand empty, waiting to be filled."
    }
    const plural = bookCount === 1 ? "book" : "books"
    return `${bookCount} ${plural} line the shelves.`
  },
}
