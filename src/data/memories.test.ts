import { test, expect, describe, beforeEach } from "bun:test"
import { MemoryStore, type Memory, type MemorySearchResult } from "./memories"

describe("MemoryStore (in-memory fallback)", () => {
  let store: MemoryStore

  beforeEach(() => {
    store = new MemoryStore()
  })

  describe("add", () => {
    test("adds a memory and returns it", async () => {
      const memory = await store.add("User likes chess", ["preferences"], 1, "library")

      expect(memory.id).toBe(1)
      expect(memory.content).toBe("User likes chess")
      expect(memory.tags).toEqual(["preferences"])
      expect(memory.sessionId).toBe(1)
      expect(memory.room).toBe("library")
      expect(memory.accessCount).toBe(0)
      expect(memory.createdAt).toBeInstanceOf(Date)
    })

    test("assigns sequential IDs", async () => {
      const m1 = await store.add("First", [], 1, "bedroom")
      const m2 = await store.add("Second", [], 1, "bedroom")
      const m3 = await store.add("Third", [], 1, "library")

      expect(m1.id).toBe(1)
      expect(m2.id).toBe(2)
      expect(m3.id).toBe(3)
    })
  })

  describe("search", () => {
    test("finds memories by content substring", async () => {
      await store.add("User enjoys playing chess", ["games"], 1, "library")
      await store.add("The weather was nice today", ["observation"], 1, "library")
      await store.add("User mentioned a chess tournament", ["games"], 1, "office")

      const results = await store.search("chess")

      expect(results.length).toBe(2)
      expect(results.every((r) => r.source === "explicit")).toBe(true)
      expect(results.every((r) => r.memory.content.toLowerCase().includes("chess"))).toBe(true)
    })

    test("finds memories by tag match", async () => {
      await store.add("Some content about games", ["chess", "games"], 1, "library")
      await store.add("Unrelated content", ["books"], 1, "library")

      const results = await store.search("chess")

      expect(results.length).toBe(1)
      expect(results[0].memory.tags).toContain("chess")
    })

    test("returns empty array when no matches", async () => {
      await store.add("User likes chess", [], 1, "library")

      const results = await store.search("quantum physics")

      expect(results.length).toBe(0)
    })

    test("respects limit parameter", async () => {
      await store.add("Chess game 1", ["chess"], 1, "library")
      await store.add("Chess game 2", ["chess"], 1, "library")
      await store.add("Chess game 3", ["chess"], 1, "library")

      const results = await store.search("chess", "all", 2)

      expect(results.length).toBe(2)
    })

    test("returns empty for sessions scope in fallback mode", async () => {
      await store.add("Some memory", [], 1, "library")

      const results = await store.search("memory", "sessions")

      expect(results.length).toBe(0)
    })

    test("increments access count on search hit", async () => {
      await store.add("User likes chess", ["games"], 1, "library")

      // First search
      const results1 = await store.search("chess")
      expect(results1[0].memory.accessCount).toBe(1)

      // Second search
      const results2 = await store.search("chess")
      expect(results2[0].memory.accessCount).toBe(2)
    })
  })

  describe("remove (soft delete)", () => {
    test("soft deletes a memory", async () => {
      const memory = await store.add("To be forgotten", [], 1, "library")

      const removed = await store.remove(memory.id)

      expect(removed).toBe(true)
    })

    test("forgotten memories don't appear in search", async () => {
      const memory = await store.add("Secret chess strategy", ["chess"], 1, "library")
      await store.add("Public chess info", ["chess"], 1, "library")

      await store.remove(memory.id)

      const results = await store.search("chess")
      expect(results.length).toBe(1)
      expect(results[0].memory.content).toBe("Public chess info")
    })

    test("returns false for non-existent memory", async () => {
      const removed = await store.remove(999)

      expect(removed).toBe(false)
    })

    test("returns false when removing already deleted memory", async () => {
      const memory = await store.add("Temp", [], 1, "library")

      await store.remove(memory.id)
      const secondRemove = await store.remove(memory.id)

      expect(secondRemove).toBe(false)
    })
  })

  describe("getCount", () => {
    test("returns 0 when empty", async () => {
      expect(await store.getCount()).toBe(0)
    })

    test("counts active memories", async () => {
      await store.add("One", [], 1, "library")
      await store.add("Two", [], 1, "library")
      await store.add("Three", [], 1, "library")

      expect(await store.getCount()).toBe(3)
    })

    test("excludes deleted memories", async () => {
      const m1 = await store.add("Keep", [], 1, "library")
      const m2 = await store.add("Delete", [], 1, "library")
      await store.add("Keep too", [], 1, "library")

      await store.remove(m2.id)

      expect(await store.getCount()).toBe(2)
    })
  })

  describe("getRecentTags", () => {
    test("returns distinct tags from recent memories", async () => {
      await store.add("A", ["chess", "games"], 1, "library")
      await store.add("B", ["books", "fiction"], 1, "library")
      await store.add("C", ["chess", "tournament"], 1, "office")

      const tags = await store.getRecentTags()

      expect(tags).toContain("chess")
      expect(tags).toContain("games")
      expect(tags).toContain("books")
      expect(tags).toContain("fiction")
      expect(tags).toContain("tournament")
      // "chess" should only appear once
      expect(tags.filter((t) => t === "chess").length).toBe(1)
    })

    test("excludes tags from deleted memories", async () => {
      const m1 = await store.add("A", ["secret"], 1, "library")
      await store.add("B", ["public"], 1, "library")

      await store.remove(m1.id)

      const tags = await store.getRecentTags()

      expect(tags).toContain("public")
      expect(tags).not.toContain("secret")
    })

    test("returns empty array when no memories", async () => {
      const tags = await store.getRecentTags()

      expect(tags).toEqual([])
    })

    test("respects limit parameter", async () => {
      // Add 5 memories with different tags
      for (let i = 0; i < 5; i++) {
        await store.add(`Memory ${i}`, [`tag-${i}`], 1, "library")
      }

      // Limit to most recent 2 memories
      const tags = await store.getRecentTags(2)

      expect(tags.length).toBe(2)
      // Should be tags from the 2 most recent
      expect(tags).toContain("tag-4")
      expect(tags).toContain("tag-3")
    })
  })
})
