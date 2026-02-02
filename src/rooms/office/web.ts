/**
 * Web tools for the office room.
 * Provides web_search and fetch operations.
 */
import { z } from "zod"
import { Readability } from "@mozilla/readability"
import TurndownService from "turndown"
import { JSDOM } from "jsdom"
import type { ExecutableTool, ToolResult } from "../../types/rooms"
import { getSearchProvider } from "../../data/search"
import { truncateOutput, OUTPUT_LIMITS, DEFAULT_TIMEOUT } from "./utils"

/**
 * Convert HTML to readable Markdown.
 * Uses Readability to extract main content, then Turndown to convert to Markdown.
 */
function htmlToMarkdown(html: string, url: string): string {
  try {
    const dom = new JSDOM(html, { url })
    const reader = new Readability(dom.window.document)
    const article = reader.parse()

    if (!article || !article.content) {
      // Fallback: just strip tags if Readability fails
      return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()
    }

    const turndown = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
    })

    // Add title if available
    let markdown = ""
    if (article.title) {
      markdown = `# ${article.title}\n\n`
    }

    markdown += turndown.turndown(article.content)
    return markdown
  } catch {
    // If parsing fails, return stripped HTML
    return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()
  }
}

/**
 * Search the web.
 */
export const webSearch: ExecutableTool = {
  name: "web_search",
  description: "Search the web and return results with titles, URLs, and snippets.",
  persistResult: false,
  inputSchema: z.object({
    query: z.string().describe("The search query."),
  }),
  execute: async (params): Promise<ToolResult> => {
    const query = params.query as string

    const provider = getSearchProvider()
    if (!provider) {
      return {
        success: false,
        output:
          "Web search is not configured. Set BRAVE_SEARCH_API_KEY in environment variables.",
      }
    }

    try {
      const results = await provider.search(query)

      if (results.length === 0) {
        return {
          success: true,
          output: "No results found.",
        }
      }

      const lines: string[] = [`Search results for: "${query}"`, ""]

      results.forEach((result, i) => {
        lines.push(`${i + 1}. ${result.title}`)
        lines.push(`   ${result.url}`)
        lines.push(`   ${result.snippet}`)
        lines.push("")
      })

      return {
        success: true,
        output: lines.join("\n").trim(),
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
 * Fetch a URL and return its contents as Markdown.
 */
export const fetchUrl: ExecutableTool = {
  name: "fetch",
  persistResult: false,
  description:
    "Retrieve the contents of a URL. HTML is converted to Markdown for readability. Output is truncated at 50k characters.",
  inputSchema: z.object({
    url: z.string().describe("The URL to fetch."),
  }),
  execute: async (params): Promise<ToolResult> => {
    const url = params.url as string

    // Validate URL
    try {
      new URL(url)
    } catch {
      return {
        success: false,
        output: `Invalid URL: ${url}`,
      }
    }

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT)

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; HearthAgent/1.0; +https://github.com/hearth)",
        },
      })

      clearTimeout(timeout)

      if (!response.ok) {
        return {
          success: false,
          output: `HTTP error: ${response.status} ${response.statusText}`,
        }
      }

      const contentType = response.headers.get("content-type") || ""
      const body = await response.text()

      let content: string
      if (contentType.includes("text/html")) {
        // Convert HTML to Markdown
        content = htmlToMarkdown(body, url)
      } else if (
        contentType.includes("application/json") ||
        contentType.includes("text/plain") ||
        contentType.includes("text/markdown")
      ) {
        // Return as-is for text formats
        content = body
      } else {
        // For other types, just return raw text
        content = body
      }

      const truncated = truncateOutput(content, OUTPUT_LIMITS.fetch)

      return {
        success: true,
        output: truncated,
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return {
          success: false,
          output: `Request timed out after ${DEFAULT_TIMEOUT / 1000} seconds.`,
        }
      }

      const message = error instanceof Error ? error.message : "Unknown error"
      return {
        success: false,
        output: `Fetch failed: ${message}`,
      }
    }
  },
}

/**
 * All web tools exported as an array.
 */
export const webTools: ExecutableTool[] = [webSearch, fetchUrl]
