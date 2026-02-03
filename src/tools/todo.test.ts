import { test, expect, describe } from "bun:test"
import { todo } from "./todo"
import { makeTestContext } from "../test-helpers"

function makeContext(overrides: Partial<import("../types/rooms").AgentContext> = {}) {
  return makeTestContext({ currentRoom: "office", ...overrides })
}

describe("todo tool", () => {
  const ctx = makeContext()

  test("add requires subject", async () => {
    const result = await todo.execute({ action: "add" }, ctx)
    expect(result.success).toBe(false)
    expect(result.output).toContain("subject is required")
  })

  test("add creates todo with default priority", async () => {
    const result = await todo.execute({ action: "add", subject: "Fix bug" }, ctx)
    expect(result.success).toBe(true)
    expect(result.output).toMatch(/Created todo #\d+: "Fix bug" \(priority 999\)/)
  })

  test("add creates todo with custom priority", async () => {
    const result = await todo.execute({ action: "add", subject: "Important task", priority: 1 }, ctx)
    expect(result.success).toBe(true)
    expect(result.output).toContain("priority 1")
  })

  test("add creates todo with content", async () => {
    const result = await todo.execute(
      { action: "add", subject: "Research", content: "Look into new framework", priority: 5 },
      ctx
    )
    expect(result.success).toBe(true)
    expect(result.output).toContain("Research")
  })

  test("add validates priority range", async () => {
    const r1 = await todo.execute({ action: "add", subject: "Test", priority: 0 }, ctx)
    expect(r1.success).toBe(false)

    const r2 = await todo.execute({ action: "add", subject: "Test", priority: 1000 }, ctx)
    expect(r2.success).toBe(false)
  })

  test("list shows empty message when no todos", async () => {
    const freshCtx = makeContext()
    const result = await todo.execute({ action: "list" }, freshCtx)
    expect(result.success).toBe(true)
    expect(result.output).toContain("No active todos")
  })

  test("list shows todos with counts", async () => {
    const ctx2 = makeContext()
    await todo.execute({ action: "add", subject: "Task 1", priority: 1 }, ctx2)
    await todo.execute({ action: "add", subject: "Task 2", priority: 2 }, ctx2)

    const result = await todo.execute({ action: "list" }, ctx2)
    expect(result.success).toBe(true)
    expect(result.output).toContain("2 pending, 0 in progress")
    expect(result.output).toContain("Task 1")
    expect(result.output).toContain("Task 2")
    expect(result.output).toContain("[P1]")
    expect(result.output).toContain("[P2]")
  })

  test("list shows status tags for non-pending todos", async () => {
    const ctx3 = makeContext()
    await todo.execute({ action: "add", subject: "Task 1" }, ctx3)
    const listResult = await todo.execute({ action: "list" }, ctx3)
    const match = listResult.output.match(/#(\d+)/)
    if (!match) throw new Error("Could not find todo in list")
    const todoId = parseInt(match[1])

    await todo.execute({ action: "update", id: todoId, status: "in_progress" }, ctx3)

    const result = await todo.execute({ action: "list" }, ctx3)
    expect(result.success).toBe(true)
    expect(result.output).toContain("[in_progress]")
  })

  test("list with all=true shows resolved todos", async () => {
    const ctx4 = makeContext()
    await todo.execute({ action: "add", subject: "Task 1" }, ctx4)
    const listResult = await todo.execute({ action: "list" }, ctx4)
    const match = listResult.output.match(/#(\d+)/)
    if (!match) throw new Error("Could not find todo")
    const todoId = parseInt(match[1])

    await todo.execute({ action: "update", id: todoId, status: "done" }, ctx4)

    // Without all flag, should show today's resolved todos
    const defaultResult = await todo.execute({ action: "list" }, ctx4)
    expect(defaultResult.output).toContain("[done]")
    expect(defaultResult.output).toContain("(resolved today)")

    // With all flag, should show all
    const allResult = await todo.execute({ action: "list", all: true }, ctx4)
    expect(allResult.output).toContain("[done]")
  })

  test("update requires id", async () => {
    const result = await todo.execute({ action: "update" }, ctx)
    expect(result.success).toBe(false)
    expect(result.output).toContain("id is required")
  })

  test("update requires at least one field", async () => {
    const result = await todo.execute({ action: "update", id: 999 }, ctx)
    expect(result.success).toBe(false)
    expect(result.output).toContain("No fields provided")
  })

  test("update returns error for nonexistent todo", async () => {
    const result = await todo.execute({ action: "update", id: 99999, subject: "New" }, ctx)
    expect(result.success).toBe(false)
    expect(result.output).toContain("not found")
  })

  test("update changes status with transition message", async () => {
    const ctx5 = makeContext()
    await todo.execute({ action: "add", subject: "Task" }, ctx5)
    const listResult = await todo.execute({ action: "list" }, ctx5)
    const match = listResult.output.match(/#(\d+)/)
    if (!match) throw new Error("Could not find todo")
    const todoId = parseInt(match[1])

    const result = await todo.execute({ action: "update", id: todoId, status: "in_progress" }, ctx5)
    expect(result.success).toBe(true)
    expect(result.output).toContain("status pending → in_progress")
  })

  test("update validates status transitions", async () => {
    const ctx6 = makeContext()
    await todo.execute({ action: "add", subject: "Task" }, ctx6)
    const listResult = await todo.execute({ action: "list" }, ctx6)
    const match = listResult.output.match(/#(\d+)/)
    if (!match) throw new Error("Could not find todo")
    const todoId = parseInt(match[1])

    // Mark as done
    await todo.execute({ action: "update", id: todoId, status: "done" }, ctx6)

    // Try to change back to pending (invalid)
    const result = await todo.execute({ action: "update", id: todoId, status: "pending" }, ctx6)
    expect(result.success).toBe(false)
    expect(result.output).toContain("Invalid status transition")
  })

  test("update changes subject", async () => {
    const ctx7 = makeContext()
    await todo.execute({ action: "add", subject: "Old subject" }, ctx7)
    const listResult = await todo.execute({ action: "list" }, ctx7)
    const match = listResult.output.match(/#(\d+)/)
    if (!match) throw new Error("Could not find todo")
    const todoId = parseInt(match[1])

    const result = await todo.execute({ action: "update", id: todoId, subject: "New subject" }, ctx7)
    expect(result.success).toBe(true)
    expect(result.output).toContain(`Updated todo #${todoId}`)

    const listAfter = await todo.execute({ action: "list" }, ctx7)
    expect(listAfter.output).toContain("New subject")
    expect(listAfter.output).not.toContain("Old subject")
  })

  test("update changes priority", async () => {
    const ctx8 = makeContext()
    await todo.execute({ action: "add", subject: "Task", priority: 50 }, ctx8)
    const listResult = await todo.execute({ action: "list" }, ctx8)
    const match = listResult.output.match(/#(\d+)/)
    if (!match) throw new Error("Could not find todo")
    const todoId = parseInt(match[1])

    const result = await todo.execute({ action: "update", id: todoId, priority: 1 }, ctx8)
    expect(result.success).toBe(true)

    const listAfter = await todo.execute({ action: "list" }, ctx8)
    expect(listAfter.output).toContain("[P1]")
  })

  test("remove requires id", async () => {
    const result = await todo.execute({ action: "remove" }, ctx)
    expect(result.success).toBe(false)
    expect(result.output).toContain("id is required")
  })

  test("remove returns error for nonexistent todo", async () => {
    const result = await todo.execute({ action: "remove", id: 99999 }, ctx)
    expect(result.success).toBe(false)
    expect(result.output).toContain("not found")
  })

  test("remove deletes todo permanently", async () => {
    const ctx9 = makeContext()
    await todo.execute({ action: "add", subject: "To be removed" }, ctx9)
    const listResult = await todo.execute({ action: "list" }, ctx9)
    const match = listResult.output.match(/#(\d+)/)
    if (!match) throw new Error("Could not find todo")
    const todoId = parseInt(match[1])

    const removeResult = await todo.execute({ action: "remove", id: todoId }, ctx9)
    expect(removeResult.success).toBe(true)
    expect(removeResult.output).toContain(`Todo #${todoId} removed`)

    const listAfter = await todo.execute({ action: "list" }, ctx9)
    expect(listAfter.output).toContain("No active todos")
  })

  test("unknown action returns error", async () => {
    const result = await todo.execute({ action: "invalid" as any }, ctx)
    expect(result.success).toBe(false)
    expect(result.output).toContain("Unknown action")
  })
})
