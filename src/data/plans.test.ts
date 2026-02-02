import { test, expect, describe, beforeEach } from "bun:test"
import { PlanStore } from "./plans"

describe("PlanStore (in-memory fallback)", () => {
  let store: PlanStore

  beforeEach(() => {
    store = new PlanStore()
  })

  describe("createPlan", () => {
    test("creates a plan and returns it", async () => {
      const plan = await store.createPlan("Read the books", 1)

      expect(plan.id).toBe(1)
      expect(plan.title).toBe("Read the books")
      expect(plan.status).toBe("open")
      expect(plan.isActive).toBe(false)
      expect(plan.createdSession).toBe(1)
      expect(plan.tasks).toEqual([])
      expect(plan.createdAt).toBeInstanceOf(Date)
    })

    test("assigns sequential IDs", async () => {
      const p1 = await store.createPlan("First", 1)
      const p2 = await store.createPlan("Second", 1)

      expect(p1.id).toBe(1)
      expect(p2.id).toBe(2)
    })
  })

  describe("closePlan", () => {
    test("closes an open plan", async () => {
      const plan = await store.createPlan("Test", 1)
      const closed = await store.closePlan(plan.id)

      expect(closed).toBe(true)

      const fetched = await store.getPlan(plan.id)
      expect(fetched!.status).toBe("closed")
    })

    test("returns false for non-existent plan", async () => {
      expect(await store.closePlan(999)).toBe(false)
    })

    test("clears active flag when closing the active plan", async () => {
      const plan = await store.createPlan("Test", 1)
      await store.setActive(plan.id)
      await store.closePlan(plan.id)

      const active = await store.getActive()
      expect(active).toBeNull()
    })
  })

  describe("setActive / clearActive / getActive", () => {
    test("sets a plan as active", async () => {
      const plan = await store.createPlan("Test", 1)
      await store.setActive(plan.id)

      const active = await store.getActive()
      expect(active).not.toBeNull()
      expect(active!.id).toBe(plan.id)
    })

    test("only one plan can be active at a time", async () => {
      const p1 = await store.createPlan("First", 1)
      const p2 = await store.createPlan("Second", 1)

      await store.setActive(p1.id)
      await store.setActive(p2.id)

      const active = await store.getActive()
      expect(active!.id).toBe(p2.id)

      const p1Fetched = await store.getPlan(p1.id)
      expect(p1Fetched!.isActive).toBe(false)
    })

    test("returns false when setting non-existent plan as active", async () => {
      expect(await store.setActive(999)).toBe(false)
    })

    test("returns false when setting closed plan as active", async () => {
      const plan = await store.createPlan("Test", 1)
      await store.closePlan(plan.id)

      expect(await store.setActive(plan.id)).toBe(false)
    })

    test("clearActive unsets the active plan", async () => {
      const plan = await store.createPlan("Test", 1)
      await store.setActive(plan.id)
      await store.clearActive()

      expect(await store.getActive()).toBeNull()
    })

    test("getActive returns null when no plan is active", async () => {
      expect(await store.getActive()).toBeNull()
    })
  })

  describe("addTask", () => {
    test("adds a task to a plan", async () => {
      const plan = await store.createPlan("Test", 1)
      const task = await store.addTask(plan.id, "Do the thing")

      expect(task).not.toBeNull()
      expect(task!.id).toBe(1)
      expect(task!.planId).toBe(plan.id)
      expect(task!.content).toBe("Do the thing")
      expect(task!.notes).toBeNull()
      expect(task!.status).toBe("open")
      expect(task!.sortOrder).toBe(0)
    })

    test("adds task with notes", async () => {
      const plan = await store.createPlan("Test", 1)
      const task = await store.addTask(plan.id, "Read chapter 1", "Started on page 5")

      expect(task!.notes).toBe("Started on page 5")
    })

    test("assigns sequential sort orders", async () => {
      const plan = await store.createPlan("Test", 1)
      const t1 = await store.addTask(plan.id, "First")
      const t2 = await store.addTask(plan.id, "Second")
      const t3 = await store.addTask(plan.id, "Third")

      expect(t1!.sortOrder).toBe(0)
      expect(t2!.sortOrder).toBe(1)
      expect(t3!.sortOrder).toBe(2)
    })

    test("returns null for non-existent plan", async () => {
      expect(await store.addTask(999, "Nothing")).toBeNull()
    })
  })

  describe("updateTask", () => {
    test("updates task content", async () => {
      const plan = await store.createPlan("Test", 1)
      const task = await store.addTask(plan.id, "Original")

      await store.updateTask(task!.id, { content: "Updated" })

      const fetched = await store.getPlan(plan.id)
      expect(fetched!.tasks[0].content).toBe("Updated")
    })

    test("updates task status", async () => {
      const plan = await store.createPlan("Test", 1)
      const task = await store.addTask(plan.id, "Do it")

      await store.updateTask(task!.id, { status: "done" })

      const fetched = await store.getPlan(plan.id)
      expect(fetched!.tasks[0].status).toBe("done")
    })

    test("updates task notes", async () => {
      const plan = await store.createPlan("Test", 1)
      const task = await store.addTask(plan.id, "Read")

      await store.updateTask(task!.id, { notes: "Got to page 10" })

      const fetched = await store.getPlan(plan.id)
      expect(fetched!.tasks[0].notes).toBe("Got to page 10")
    })

    test("returns false for non-existent task", async () => {
      expect(await store.updateTask(999, { status: "done" })).toBe(false)
    })
  })

  describe("removeTask", () => {
    test("removes a task", async () => {
      const plan = await store.createPlan("Test", 1)
      const task = await store.addTask(plan.id, "Delete me")

      const removed = await store.removeTask(task!.id)
      expect(removed).toBe(true)

      const fetched = await store.getPlan(plan.id)
      expect(fetched!.tasks.length).toBe(0)
    })

    test("returns false for non-existent task", async () => {
      expect(await store.removeTask(999)).toBe(false)
    })
  })

  describe("getPlan", () => {
    test("returns plan with tasks", async () => {
      const plan = await store.createPlan("Test", 1)
      await store.addTask(plan.id, "Task A")
      await store.addTask(plan.id, "Task B")

      const fetched = await store.getPlan(plan.id)
      expect(fetched).not.toBeNull()
      expect(fetched!.title).toBe("Test")
      expect(fetched!.tasks.length).toBe(2)
      expect(fetched!.tasks[0].content).toBe("Task A")
      expect(fetched!.tasks[1].content).toBe("Task B")
    })

    test("returns null for non-existent plan", async () => {
      expect(await store.getPlan(999)).toBeNull()
    })

    test("returns tasks in sort order", async () => {
      const plan = await store.createPlan("Test", 1)
      await store.addTask(plan.id, "First")
      await store.addTask(plan.id, "Second")
      await store.addTask(plan.id, "Third")

      const fetched = await store.getPlan(plan.id)
      expect(fetched!.tasks.map((t) => t.content)).toEqual(["First", "Second", "Third"])
    })
  })

  describe("listOpen", () => {
    test("returns only open plans", async () => {
      const p1 = await store.createPlan("Open 1", 1)
      await store.createPlan("Open 2", 1)
      const p3 = await store.createPlan("Will close", 1)
      await store.closePlan(p3.id)

      const open = await store.listOpen()
      expect(open.length).toBe(2)
    })

    test("includes tasks in listed plans", async () => {
      const plan = await store.createPlan("With tasks", 1)
      await store.addTask(plan.id, "A task")

      const open = await store.listOpen()
      expect(open[0].tasks.length).toBe(1)
    })

    test("returns empty array when no open plans", async () => {
      const plan = await store.createPlan("Only plan", 1)
      await store.closePlan(plan.id)

      expect(await store.listOpen()).toEqual([])
    })
  })

  describe("getOpenCount", () => {
    test("returns 0 when empty", async () => {
      expect(await store.getOpenCount()).toBe(0)
    })

    test("counts only open plans", async () => {
      await store.createPlan("One", 1)
      await store.createPlan("Two", 1)
      const p3 = await store.createPlan("Three", 1)
      await store.closePlan(p3.id)

      expect(await store.getOpenCount()).toBe(2)
    })
  })
})
