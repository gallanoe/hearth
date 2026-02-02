/**
 * Book storage for the library room.
 * Loads books from text files and provides lookup functionality.
 */

export interface Book {
  title: string   // Human-readable title
  slug: string    // Normalized for matching
  content: string // Full text content
}

/**
 * Result of paginating book content.
 */
export interface PaginatedContent {
  content: string      // The page content with ellipses as needed
  page: number         // Current page (1-indexed)
  totalPages: number   // Total pages in book
  isComplete: boolean  // True if entire book fits in one page
}

import { PAGE_SIZE } from "../config"

/**
 * Paginates book content with ellipses indicators.
 * - Prepends "..." if not on page 1
 * - Appends "..." if not on last page
 */
export function paginateContent(
  fullContent: string,
  page: number = 1,
  pageSize: number = PAGE_SIZE
): PaginatedContent {
  const totalPages = Math.ceil(fullContent.length / pageSize)
  
  // Clamp page to valid range
  const validPage = Math.max(1, Math.min(page, totalPages))
  
  // If content fits in one page, return it all
  if (totalPages <= 1) {
    return {
      content: fullContent,
      page: 1,
      totalPages: 1,
      isComplete: true,
    }
  }
  
  // Calculate slice boundaries
  const start = (validPage - 1) * pageSize
  const end = Math.min(start + pageSize, fullContent.length)
  let content = fullContent.slice(start, end)
  
  // Add ellipses indicators
  const isFirstPage = validPage === 1
  const isLastPage = validPage === totalPages
  
  if (!isFirstPage) {
    content = "..." + content
  }
  if (!isLastPage) {
    content = content + "..."
  }
  
  return {
    content,
    page: validPage,
    totalPages,
    isComplete: false,
  }
}

/**
 * Converts a filename to a human-readable title.
 * "on-the-shortness-of-life.txt" -> "On the Shortness of Life"
 */
function filenameToTitle(filename: string): string {
  // Remove extension
  const name = filename.replace(/\.txt$/i, "")
  
  // Split on hyphens and underscores
  const words = name.split(/[-_]+/)
  
  // Capitalize each word, with exceptions for small words
  const smallWords = new Set(["a", "an", "the", "and", "but", "or", "for", "nor", "on", "at", "to", "by", "of"])
  
  return words
    .map((word, index) => {
      const lower = word.toLowerCase()
      // Always capitalize first word, otherwise check if it's a small word
      if (index === 0 || !smallWords.has(lower)) {
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
      }
      return lower
    })
    .join(" ")
}

/**
 * Converts a title to a slug for matching.
 */
function titleToSlug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
}

/**
 * In-memory storage for books.
 */
export class BookStore {
  private books: Map<string, Book> = new Map()
  private loaded: boolean = false

  /**
   * Load all books from a directory.
   * Reads all .txt files and converts them to books.
   */
  async loadFromDirectory(dirPath: string): Promise<void> {
    const { readdir } = await import("node:fs/promises")
    const { join } = await import("node:path")
    
    try {
      const files = await readdir(dirPath)
      const txtFiles = files.filter((f) => f.endsWith(".txt"))

      for (const filename of txtFiles) {
        const filePath = join(dirPath, filename)
        const file = Bun.file(filePath)
        const content = await file.text()
        
        const title = filenameToTitle(filename)
        const slug = titleToSlug(title)
        
        this.books.set(slug, { title, slug, content })
      }

      this.loaded = true
      console.log(`📚 Loaded ${this.books.size} books`)
    } catch (error) {
      // Directory might not exist yet, that's okay
      console.log(`📚 No books directory found at ${dirPath}`)
      this.loaded = true
    }
  }

  /**
   * Check if books have been loaded.
   */
  isLoaded(): boolean {
    return this.loaded
  }

  /**
   * List all available books.
   */
  list(): Book[] {
    return Array.from(this.books.values()).sort((a, b) => a.title.localeCompare(b.title))
  }

  /**
   * Get a book by title (case-insensitive).
   */
  get(title: string): Book | undefined {
    const slug = titleToSlug(title)
    return this.books.get(slug)
  }

  /**
   * Get count of available books.
   */
  getCount(): number {
    return this.books.size
  }

  /**
   * Get all book titles.
   */
  getTitles(): string[] {
    return this.list().map((b) => b.title)
  }
}

/**
 * Singleton book store instance.
 */
export const bookStore = new BookStore()
