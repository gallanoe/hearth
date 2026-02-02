import { test, expect, describe } from "bun:test"
import { remember, recall, forget } from "./memory"
import { makeTestContext } from "../test-helpers"

function makeContext() {
  return makeTestContext({ currentRoom: "library" })
}

describe("remember tool", () => {
  test("has correct name", () => {
    expect(remember.name).toBe("remember")
  })

  test("stores a memory and returns its ID", async () => {
    const ctx = makeContext()
    const result = await remember.execute(
      { content: "Test memory for tool test", tags: ["test"] },
      ctx
    )
    expect(result.success).toBe(true)
    expect(result.output).toContain("Memory #")
    expect(result.output).toContain("test")
  })

  test("handles missing tags gracefully", async () => {
    const ctx = makeContext()
    const result = await remember.execute(
      { content: "No tags memory" },
      ctx
    )
    expect(result.success).toBe(true)
    expect(result.output).toContain("none")
  })
})

describe("recall tool", () => {
  test("has correct name", () => {
    expect(recall.name).toBe("recall")
  })

  test("finds previously stored memories", async () => {
    const ctx = makeContext()
    // Store something first
    await remember.execute({ content: "Recall test unique xyz123", tags: ["recall-test"] }, ctx)

    const result = await recall.execute({ query: "xyz123" }, ctx)
    expect(result.success).toBe(true)
    expect(result.output).toContain("xyz123")
  })

  test("returns empty message when nothing matches", async () => {
    const ctx = makeContext()
    const result = await recall.execute(
      { query: "absolutely_nonexistent_query_string_999" },
      ctx
    )
    expect(result.success).toBe(true)
    expect(result.output).toContain("No matching memories")
  })
})

describe("forget tool", () => {
  test("has correct name", () => {
    expect(forget.name).toBe("forget")
  })

  test("removes a memory by ID", async () => {
    const ctx = makeContext()
    // Store a memory and extract its ID
    const storeResult = await remember.execute(
      { content: "Memory to forget unique abc789" },
      ctx
    )
    const idMatch = storeResult.output.match(/Memory #(\d+)/)
    expect(idMatch).not.toBeNull()
    const memoryId = parseInt(idMatch![1])

    const result = await forget.execute({ memoryId }, ctx)
    expect(result.success).toBe(true)
    expect(result.output).toContain("forgotten")
  })

  test("fails for nonexistent memory ID", async () => {
    const ctx = makeContext()
    const result = await forget.execute({ memoryId: 999999 }, ctx)
    expect(result.success).toBe(false)
    expect(result.output).toContain("No active memory")
  })
})
