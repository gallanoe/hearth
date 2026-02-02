import { test, expect, describe, beforeEach } from "bun:test"
import { paginateContent, BookStore } from "./books"

describe("paginateContent", () => {
  test("returns full content when it fits in one page", () => {
    const result = paginateContent("Hello world", 1, 100)
    expect(result.content).toBe("Hello world")
    expect(result.page).toBe(1)
    expect(result.totalPages).toBe(1)
    expect(result.isComplete).toBe(true)
  })

  test("returns full content for empty string", () => {
    const result = paginateContent("", 1, 100)
    expect(result.content).toBe("")
    expect(result.isComplete).toBe(true)
  })

  test("paginates content across multiple pages", () => {
    const content = "abcdefghij" // 10 chars
    const result = paginateContent(content, 1, 5)
    expect(result.page).toBe(1)
    expect(result.totalPages).toBe(2)
    expect(result.isComplete).toBe(false)
    // First page: no leading ellipsis, trailing ellipsis
    expect(result.content).toBe("abcde...")
  })

  test("adds leading ellipsis on non-first pages", () => {
    const content = "abcdefghij" // 10 chars
    const result = paginateContent(content, 2, 5)
    expect(result.page).toBe(2)
    // Last page: leading ellipsis, no trailing
    expect(result.content).toBe("...fghij")
  })

  test("adds both ellipses on middle pages", () => {
    const content = "abcdefghijklmno" // 15 chars
    const result = paginateContent(content, 2, 5)
    expect(result.page).toBe(2)
    expect(result.totalPages).toBe(3)
    expect(result.content).toBe("...fghij...")
  })

  test("clamps page below 1 to page 1", () => {
    const result = paginateContent("abcdefghij", 0, 5)
    expect(result.page).toBe(1)
  })

  test("clamps page above totalPages to last page", () => {
    const result = paginateContent("abcdefghij", 99, 5)
    expect(result.page).toBe(2)
  })
})

describe("BookStore", () => {
  let store: BookStore

  beforeEach(() => {
    store = new BookStore()
  })

  test("starts unloaded with no books", () => {
    expect(store.isLoaded()).toBe(false)
    expect(store.getCount()).toBe(0)
    expect(store.list()).toEqual([])
    expect(store.getTitles()).toEqual([])
  })

  test("loads books from a directory", async () => {
    // Create a temp directory with test books
    const { mkdtemp, writeFile, rm } = await import("node:fs/promises")
    const { join } = await import("node:path")
    const { tmpdir } = await import("node:os")

    const dir = await mkdtemp(join(tmpdir(), "books-test-"))
    try {
      await writeFile(join(dir, "moby-dick.txt"), "Call me Ishmael.")
      await writeFile(join(dir, "on-the-shortness-of-life.txt"), "It is not that we have a short time to live...")

      await store.loadFromDirectory(dir)

      expect(store.isLoaded()).toBe(true)
      expect(store.getCount()).toBe(2)

      const titles = store.getTitles()
      expect(titles).toContain("Moby Dick")
      expect(titles).toContain("On the Shortness of Life")
    } finally {
      await rm(dir, { recursive: true })
    }
  })

  test("gets a book by title (case-insensitive)", async () => {
    const { mkdtemp, writeFile, rm } = await import("node:fs/promises")
    const { join } = await import("node:path")
    const { tmpdir } = await import("node:os")

    const dir = await mkdtemp(join(tmpdir(), "books-test-"))
    try {
      await writeFile(join(dir, "moby-dick.txt"), "Call me Ishmael.")
      await store.loadFromDirectory(dir)

      const book = store.get("Moby Dick")
      expect(book).toBeDefined()
      expect(book!.content).toBe("Call me Ishmael.")

      // Case insensitive
      const book2 = store.get("moby dick")
      expect(book2).toBeDefined()
      expect(book2!.title).toBe("Moby Dick")
    } finally {
      await rm(dir, { recursive: true })
    }
  })

  test("returns undefined for unknown book", async () => {
    const { mkdtemp, rm } = await import("node:fs/promises")
    const { tmpdir } = await import("node:os")
    const { join } = await import("node:path")

    const dir = await mkdtemp(join(tmpdir(), "books-test-"))
    try {
      await store.loadFromDirectory(dir)
      expect(store.get("nonexistent")).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true })
    }
  })

  test("handles missing directory gracefully", async () => {
    await store.loadFromDirectory("/nonexistent/path/books")
    expect(store.isLoaded()).toBe(true)
    expect(store.getCount()).toBe(0)
  })

  test("lists books sorted alphabetically", async () => {
    const { mkdtemp, writeFile, rm } = await import("node:fs/promises")
    const { join } = await import("node:path")
    const { tmpdir } = await import("node:os")

    const dir = await mkdtemp(join(tmpdir(), "books-test-"))
    try {
      await writeFile(join(dir, "zebra.txt"), "z")
      await writeFile(join(dir, "apple.txt"), "a")
      await writeFile(join(dir, "moby-dick.txt"), "m")

      await store.loadFromDirectory(dir)

      const titles = store.getTitles()
      expect(titles[0]).toBe("Apple")
      expect(titles[1]).toBe("Moby Dick")
      expect(titles[2]).toBe("Zebra")
    } finally {
      await rm(dir, { recursive: true })
    }
  })

  test("ignores non-txt files", async () => {
    const { mkdtemp, writeFile, rm } = await import("node:fs/promises")
    const { join } = await import("node:path")
    const { tmpdir } = await import("node:os")

    const dir = await mkdtemp(join(tmpdir(), "books-test-"))
    try {
      await writeFile(join(dir, "book.txt"), "content")
      await writeFile(join(dir, "notes.md"), "not a book")
      await writeFile(join(dir, "data.json"), "{}")

      await store.loadFromDirectory(dir)
      expect(store.getCount()).toBe(1)
    } finally {
      await rm(dir, { recursive: true })
    }
  })
})
