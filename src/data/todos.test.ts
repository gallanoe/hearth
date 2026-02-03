import { test, expect, describe, beforeEach } from "bun:test"
import { TodoStore, type TodoStatus } from "./todos"

describe("TodoStore (in-memory fallback)", () => {
  let store: TodoStore

  beforeEach(() => {
    store = new TodoStore(null, "test-agent")
  })

  describe("add", () => {
    test("creates a todo with default values", async () => {
      const todo = await store.add("Write tests")

      expect(todo.id).toBe(1)
      expect(todo.agentId).toBe("test-agent")
      expect(todo.subject).toBe("Write tests")
      expect(todo.content).toBe("")
      expect(todo.priority).toBe(999)
      expect(todo.status).toBe("pending")
      expect(todo.resolvedAt).toBeNull()
      expect(todo.createdAt).toBeInstanceOf(Date)
      expect(todo.updatedAt).toBeInstanceOf(Date)
    })

    test("creates a todo with content and priority", async () => {
      const todo = await store.add("Fix bug", "The login form is broken", 5)

      expect(todo.subject).toBe("Fix bug")
      expect(todo.content).toBe("The login form is broken")
      expect(todo.priority).toBe(5)
    })

    test("assigns sequential IDs", async () => {
      const t1 = await store.add("First")
      const t2 = await store.add("Second")
      const t3 = await store.add("Third")

      expect(t1.id).toBe(1)
      expect(t2.id).toBe(2)
      expect(t3.id).toBe(3)
    })

    test("throws error for priority below 1", async () => {
      await expect(store.add("Test", "", 0)).rejects.toThrow("Priority must be between 1 and 999")
    })

    test("throws error for priority above 999", async () => {
      await expect(store.add("Test", "", 1000)).rejects.toThrow("Priority must be between 1 and 999")
    })

    test("accepts priority boundaries (1 and 999)", async () => {
      const t1 = await store.add("High priority", "", 1)
      const t2 = await store.add("Low priority", "", 999)

      expect(t1.priority).toBe(1)
      expect(t2.priority).toBe(999)
    })
  })

  describe("update", () => {
    test("updates subject", async () => {
      const todo = await store.add("Original")
      const updated = await store.update(todo.id, { subject: "Updated" })

      expect(updated.subject).toBe("Updated")
      expect(updated.content).toBe(todo.content)
      expect(updated.priority).toBe(todo.priority)
    })

    test("updates content", async () => {
      const todo = await store.add("Task", "Original content")
      const updated = await store.update(todo.id, { content: "New content" })

      expect(updated.content).toBe("New content")
      expect(updated.subject).toBe(todo.subject)
    })

    test("updates priority", async () => {
      const todo = await store.add("Task", "", 100)
      const updated = await store.update(todo.id, { priority: 50 })

      expect(updated.priority).toBe(50)
    })

    test("updates status", async () => {
      const todo = await store.add("Task")
      const updated = await store.update(todo.id, { status: "in_progress" })

      expect(updated.status).toBe("in_progress")
    })

    test("updates multiple fields at once", async () => {
      const todo = await store.add("Task")
      const updated = await store.update(todo.id, {
        subject: "New subject",
        content: "New content",
        priority: 42,
        status: "in_progress",
      })

      expect(updated.subject).toBe("New subject")
      expect(updated.content).toBe("New content")
      expect(updated.priority).toBe(42)
      expect(updated.status).toBe("in_progress")
    })

    test("sets resolvedAt when transitioning to done", async () => {
      const todo = await store.add("Task")
      const updated = await store.update(todo.id, { status: "done" })

      expect(updated.resolvedAt).toBeInstanceOf(Date)
      expect(updated.resolvedAt!.getTime()).toBeGreaterThanOrEqual(todo.createdAt.getTime())
    })

    test("sets resolvedAt when transitioning to cancelled", async () => {
      const todo = await store.add("Task")
      const updated = await store.update(todo.id, { status: "cancelled" })

      expect(updated.resolvedAt).toBeInstanceOf(Date)
    })

    test("does not change resolvedAt when already resolved", async () => {
      const todo = await store.add("Task")
      const done = await store.update(todo.id, { status: "done" })
      const resolvedAt = done.resolvedAt

      // Update something else
      const updated = await store.update(todo.id, { subject: "Changed" })

      expect(updated.resolvedAt).toEqual(resolvedAt)
    })

    test("throws error for priority below 1", async () => {
      const todo = await store.add("Task")
      await expect(store.update(todo.id, { priority: 0 })).rejects.toThrow(
        "Priority must be between 1 and 999"
      )
    })

    test("throws error for priority above 999", async () => {
      const todo = await store.add("Task")
      await expect(store.update(todo.id, { priority: 1000 })).rejects.toThrow(
        "Priority must be between 1 and 999"
      )
    })

    test("throws error for non-existent todo", async () => {
      await expect(store.update(999, { subject: "Test" })).rejects.toThrow("Todo with id 999 not found")
    })

    test("updates updatedAt timestamp", async () => {
      const todo = await store.add("Task")
      const originalUpdatedAt = todo.updatedAt

      // Wait a bit to ensure timestamp difference
      const updated = await store.update(todo.id, { subject: "Changed" })

      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(originalUpdatedAt.getTime())
    })
  })

  describe("status transitions", () => {
    test("allows pending -> in_progress", async () => {
      const todo = await store.add("Task")
      const updated = await store.update(todo.id, { status: "in_progress" })
      expect(updated.status).toBe("in_progress")
    })

    test("allows pending -> done", async () => {
      const todo = await store.add("Task")
      const updated = await store.update(todo.id, { status: "done" })
      expect(updated.status).toBe("done")
    })

    test("allows pending -> cancelled", async () => {
      const todo = await store.add("Task")
      const updated = await store.update(todo.id, { status: "cancelled" })
      expect(updated.status).toBe("cancelled")
    })

    test("allows in_progress -> pending", async () => {
      const todo = await store.add("Task")
      await store.update(todo.id, { status: "in_progress" })
      const updated = await store.update(todo.id, { status: "pending" })
      expect(updated.status).toBe("pending")
    })

    test("allows in_progress -> done", async () => {
      const todo = await store.add("Task")
      await store.update(todo.id, { status: "in_progress" })
      const updated = await store.update(todo.id, { status: "done" })
      expect(updated.status).toBe("done")
    })

    test("allows in_progress -> cancelled", async () => {
      const todo = await store.add("Task")
      await store.update(todo.id, { status: "in_progress" })
      const updated = await store.update(todo.id, { status: "cancelled" })
      expect(updated.status).toBe("cancelled")
    })

    test("rejects done -> pending", async () => {
      const todo = await store.add("Task")
      await store.update(todo.id, { status: "done" })
      await expect(store.update(todo.id, { status: "pending" })).rejects.toThrow(
        "Invalid status transition from 'done' to 'pending'"
      )
    })

    test("rejects done -> in_progress", async () => {
      const todo = await store.add("Task")
      await store.update(todo.id, { status: "done" })
      await expect(store.update(todo.id, { status: "in_progress" })).rejects.toThrow(
        "Invalid status transition from 'done' to 'in_progress'"
      )
    })

    test("rejects done -> cancelled", async () => {
      const todo = await store.add("Task")
      await store.update(todo.id, { status: "done" })
      await expect(store.update(todo.id, { status: "cancelled" })).rejects.toThrow(
        "Invalid status transition from 'done' to 'cancelled'"
      )
    })

    test("rejects cancelled -> pending", async () => {
      const todo = await store.add("Task")
      await store.update(todo.id, { status: "cancelled" })
      await expect(store.update(todo.id, { status: "pending" })).rejects.toThrow(
        "Invalid status transition from 'cancelled' to 'pending'"
      )
    })

    test("rejects cancelled -> in_progress", async () => {
      const todo = await store.add("Task")
      await store.update(todo.id, { status: "cancelled" })
      await expect(store.update(todo.id, { status: "in_progress" })).rejects.toThrow(
        "Invalid status transition from 'cancelled' to 'in_progress'"
      )
    })

    test("rejects cancelled -> done", async () => {
      const todo = await store.add("Task")
      await store.update(todo.id, { status: "cancelled" })
      await expect(store.update(todo.id, { status: "done" })).rejects.toThrow(
        "Invalid status transition from 'cancelled' to 'done'"
      )
    })

    test("allows updating to same status (no-op transition)", async () => {
      const todo = await store.add("Task")
      const updated = await store.update(todo.id, { status: "pending" })
      expect(updated.status).toBe("pending")
    })
  })

  describe("remove", () => {
    test("removes a todo", async () => {
      const todo = await store.add("Delete me")
      const result = await store.remove(todo.id)

      expect(result).toBe(true)
      expect(await store.get(todo.id)).toBeNull()
    })

    test("returns false for non-existent todo", async () => {
      expect(await store.remove(999)).toBe(false)
    })

    test("removes correct todo when multiple exist", async () => {
      const t1 = await store.add("First")
      const t2 = await store.add("Second")
      const t3 = await store.add("Third")

      await store.remove(t2.id)

      expect(await store.get(t1.id)).not.toBeNull()
      expect(await store.get(t2.id)).toBeNull()
      expect(await store.get(t3.id)).not.toBeNull()
    })
  })

  describe("get", () => {
    test("returns a todo by id", async () => {
      const todo = await store.add("Find me", "Some content", 42)
      const found = await store.get(todo.id)

      expect(found).not.toBeNull()
      expect(found!.id).toBe(todo.id)
      expect(found!.subject).toBe("Find me")
      expect(found!.content).toBe("Some content")
      expect(found!.priority).toBe(42)
    })

    test("returns null for non-existent todo", async () => {
      expect(await store.get(999)).toBeNull()
    })

    test("returns correct todo after updates", async () => {
      const todo = await store.add("Original")
      await store.update(todo.id, { subject: "Updated" })
      const found = await store.get(todo.id)

      expect(found!.subject).toBe("Updated")
    })
  })

  describe("list", () => {
    test("returns empty array when no todos", async () => {
      expect(await store.list()).toEqual([])
    })

    test("returns active todos by default", async () => {
      await store.add("Pending task")
      await store.add("In progress task")
      await store.update(2, { status: "in_progress" })

      const todos = await store.list()

      expect(todos.length).toBe(2)
      expect(todos.some((t) => t.subject === "Pending task")).toBe(true)
      expect(todos.some((t) => t.subject === "In progress task")).toBe(true)
    })

    test("includes today's resolved todos by default", async () => {
      const t1 = await store.add("Active")
      const t2 = await store.add("Done today")
      await store.update(t2.id, { status: "done" })

      const todos = await store.list()

      expect(todos.length).toBe(2)
      expect(todos.some((t) => t.subject === "Done today")).toBe(true)
    })

    test("excludes old resolved todos by default", async () => {
      const t1 = await store.add("Active")
      const t2 = await store.add("Done yesterday")
      await store.update(t2.id, { status: "done" })

      // Manually set resolvedAt to yesterday
      const yesterday = new Date()
      yesterday.setUTCDate(yesterday.getUTCDate() - 1)

      // Update the fallback store directly
      const fallbackTodos = (store as any).fallbackTodos
      const idx = fallbackTodos.findIndex((t: any) => t.id === t2.id)
      if (idx !== -1) {
        fallbackTodos[idx].resolvedAt = yesterday
      }

      const todos = await store.list()

      expect(todos.length).toBe(1)
      expect(todos[0].subject).toBe("Active")
    })

    test("returns all todos when includeAll is true", async () => {
      await store.add("Pending")
      const t2 = await store.add("Done")
      await store.update(t2.id, { status: "done" })

      // Manually set resolvedAt to yesterday
      const yesterday = new Date()
      yesterday.setUTCDate(yesterday.getUTCDate() - 1)
      const fallbackTodos = (store as any).fallbackTodos
      const idx = fallbackTodos.findIndex((t: any) => t.id === t2.id)
      if (idx !== -1) {
        fallbackTodos[idx].resolvedAt = yesterday
      }

      const todos = await store.list(true)

      expect(todos.length).toBe(2)
    })

    test("sorts by priority then created date", async () => {
      const t1 = await store.add("Low priority", "", 999)
      const t2 = await store.add("High priority", "", 1)
      const t3 = await store.add("Medium priority", "", 50)

      const todos = await store.list()

      expect(todos[0].subject).toBe("High priority")
      expect(todos[1].subject).toBe("Medium priority")
      expect(todos[2].subject).toBe("Low priority")
    })

    test("sorts by created date when priorities are equal", async () => {
      const t1 = await store.add("First", "", 10)
      const t2 = await store.add("Second", "", 10)
      const t3 = await store.add("Third", "", 10)

      const todos = await store.list()

      expect(todos[0].subject).toBe("First")
      expect(todos[1].subject).toBe("Second")
      expect(todos[2].subject).toBe("Third")
    })

    test("includes cancelled todos resolved today", async () => {
      const t1 = await store.add("Active")
      const t2 = await store.add("Cancelled today")
      await store.update(t2.id, { status: "cancelled" })

      const todos = await store.list()

      expect(todos.length).toBe(2)
      expect(todos.some((t) => t.subject === "Cancelled today")).toBe(true)
    })
  })

  describe("getPendingCount", () => {
    test("returns 0 when no todos", async () => {
      expect(await store.getPendingCount()).toBe(0)
    })

    test("counts only pending todos", async () => {
      await store.add("Pending 1")
      await store.add("Pending 2")
      const t3 = await store.add("In progress")
      await store.update(t3.id, { status: "in_progress" })
      const t4 = await store.add("Done")
      await store.update(t4.id, { status: "done" })

      expect(await store.getPendingCount()).toBe(2)
    })

    test("updates count after status changes", async () => {
      const t1 = await store.add("Task 1")
      const t2 = await store.add("Task 2")

      expect(await store.getPendingCount()).toBe(2)

      await store.update(t1.id, { status: "in_progress" })
      expect(await store.getPendingCount()).toBe(1)

      await store.update(t1.id, { status: "pending" })
      expect(await store.getPendingCount()).toBe(2)

      await store.update(t2.id, { status: "done" })
      expect(await store.getPendingCount()).toBe(1)
    })
  })

  describe("agent isolation", () => {
    test("isolates todos by agent ID", async () => {
      const store1 = new TodoStore(null, "agent-1")
      const store2 = new TodoStore(null, "agent-2")

      await store1.add("Agent 1 task")
      await store2.add("Agent 2 task")

      const list1 = await store1.list()
      const list2 = await store2.list()

      expect(list1.length).toBe(1)
      expect(list2.length).toBe(1)
      expect(list1[0].subject).toBe("Agent 1 task")
      expect(list2[0].subject).toBe("Agent 2 task")
    })

    test("get does not return todos from other agents", async () => {
      const store1 = new TodoStore(null, "agent-1")
      const store2 = new TodoStore(null, "agent-2")

      const todo = await store1.add("Agent 1 task")

      expect(await store2.get(todo.id)).toBeNull()
    })

    test("update does not affect todos from other agents", async () => {
      const store1 = new TodoStore(null, "agent-1")
      const store2 = new TodoStore(null, "agent-2")

      const todo = await store1.add("Agent 1 task")

      await expect(store2.update(todo.id, { subject: "Hacked" })).rejects.toThrow(
        `Todo with id ${todo.id} not found`
      )

      const found = await store1.get(todo.id)
      expect(found!.subject).toBe("Agent 1 task")
    })

    test("remove does not affect todos from other agents", async () => {
      const store1 = new TodoStore(null, "agent-1")
      const store2 = new TodoStore(null, "agent-2")

      const todo = await store1.add("Agent 1 task")

      expect(await store2.remove(todo.id)).toBe(false)
      expect(await store1.get(todo.id)).not.toBeNull()
    })

    test("getPendingCount only counts own agent todos", async () => {
      const store1 = new TodoStore(null, "agent-1")
      const store2 = new TodoStore(null, "agent-2")

      await store1.add("Agent 1 task 1")
      await store1.add("Agent 1 task 2")
      await store2.add("Agent 2 task")

      expect(await store1.getPendingCount()).toBe(2)
      expect(await store2.getPendingCount()).toBe(1)
    })
  })
})
