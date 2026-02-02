import { test, expect, describe, beforeEach } from "bun:test"
import { RoomRegistry } from "./registry"
import type { Room } from "../types/rooms"
import { makeTestContext } from "../test-helpers"
import { z } from "zod"

function makeRoom(overrides: Partial<Room> & { id: string; name: string }): Room {
  return {
    description: `The ${overrides.name}.`,
    tools: [],
    transitions: "*",
    ...overrides,
  }
}

function makeContext(currentRoom: string) {
  return makeTestContext({ currentRoom })
}

describe("RoomRegistry", () => {
  let registry: RoomRegistry

  beforeEach(() => {
    registry = new RoomRegistry()
  })

  describe("register and get", () => {
    test("registers and retrieves a room", () => {
      const room = makeRoom({ id: "bedroom", name: "Bedroom" })
      registry.register(room)

      const retrieved = registry.get("bedroom")
      expect(retrieved).toBeDefined()
      expect(retrieved!.name).toBe("Bedroom")
    })

    test("returns undefined for unregistered room", () => {
      expect(registry.get("nonexistent")).toBeUndefined()
    })
  })

  describe("getAllRoomIds", () => {
    test("returns all registered room IDs", () => {
      registry.register(makeRoom({ id: "a", name: "A" }))
      registry.register(makeRoom({ id: "b", name: "B" }))

      const ids = registry.getAllRoomIds()
      expect(ids).toContain("a")
      expect(ids).toContain("b")
      expect(ids.length).toBe(2)
    })
  })

  describe("canTransition", () => {
    test("allows wildcard transitions to any registered room", () => {
      registry.register(makeRoom({ id: "bedroom", name: "Bedroom", transitions: "*" }))
      registry.register(makeRoom({ id: "office", name: "Office" }))

      expect(registry.canTransition("bedroom", "office")).toBe(true)
    })

    test("allows listed transitions", () => {
      registry.register(makeRoom({ id: "office", name: "Office", transitions: ["bedroom"] }))
      registry.register(makeRoom({ id: "bedroom", name: "Bedroom" }))

      expect(registry.canTransition("office", "bedroom")).toBe(true)
    })

    test("blocks unlisted transitions", () => {
      registry.register(makeRoom({ id: "office", name: "Office", transitions: ["bedroom"] }))
      registry.register(makeRoom({ id: "library", name: "Library" }))
      registry.register(makeRoom({ id: "bedroom", name: "Bedroom" }))

      expect(registry.canTransition("office", "library")).toBe(false)
    })

    test("blocks transitions to unregistered rooms", () => {
      registry.register(makeRoom({ id: "bedroom", name: "Bedroom", transitions: "*" }))
      expect(registry.canTransition("bedroom", "nonexistent")).toBe(false)
    })

    test("blocks transitions from unregistered rooms", () => {
      registry.register(makeRoom({ id: "bedroom", name: "Bedroom" }))
      expect(registry.canTransition("nonexistent", "bedroom")).toBe(false)
    })
  })

  describe("getRoomDescription", () => {
    test("returns default description for undecorated room", () => {
      registry.register(makeRoom({ id: "bedroom", name: "Bedroom" }))
      const desc = registry.getRoomDescription("bedroom")
      expect(desc).toBe("The Bedroom.")
    })

    test("returns undefined for unregistered room", () => {
      expect(registry.getRoomDescription("nonexistent")).toBeUndefined()
    })

    test("resolves function descriptions", () => {
      registry.register({
        id: "dynamic",
        name: "Dynamic",
        description: () => "Generated description",
        tools: [],
        transitions: "*",
      })
      expect(registry.getRoomDescription("dynamic")).toBe("Generated description")
    })
  })

  describe("getToolDefinitions", () => {
    test("includes room tools and universal tools", () => {
      const roomTool = {
        name: "sleep",
        description: "Go to sleep.",
        inputSchema: z.object({}),
        execute: async () => ({ success: true, output: "Sleeping..." }),
      }

      registry.register(makeRoom({ id: "bedroom", name: "Bedroom", tools: [roomTool] }))

      const defs = registry.getToolDefinitions("bedroom")
      const names = defs.map((d) => d.name)

      // Room tool
      expect(names).toContain("sleep")
      // Universal tools
      expect(names).toContain("move_to")
      expect(names).toContain("read_inbox")
      expect(names).toContain("send_message")
      expect(names).toContain("decorate_room")
      expect(names).toContain("remember")
      expect(names).toContain("recall")
      expect(names).toContain("forget")
    })

    test("returns empty array for unregistered room", () => {
      expect(registry.getToolDefinitions("nonexistent")).toEqual([])
    })
  })

  describe("getExecutableTool", () => {
    test("finds universal tools by name", () => {
      registry.register(makeRoom({ id: "bedroom", name: "Bedroom" }))
      expect(registry.getExecutableTool("bedroom", "move_to")).toBeDefined()
      expect(registry.getExecutableTool("bedroom", "read_inbox")).toBeDefined()
      expect(registry.getExecutableTool("bedroom", "remember")).toBeDefined()
    })

    test("finds room-specific tools by name", () => {
      const roomTool = {
        name: "sleep",
        description: "Go to sleep.",
        inputSchema: z.object({}),
        execute: async () => ({ success: true, output: "Sleeping..." }),
      }

      registry.register(makeRoom({ id: "bedroom", name: "Bedroom", tools: [roomTool] }))
      const tool = registry.getExecutableTool("bedroom", "sleep")
      expect(tool).toBeDefined()
      expect(tool!.name).toBe("sleep")
    })

    test("returns undefined for nonexistent tool", () => {
      registry.register(makeRoom({ id: "bedroom", name: "Bedroom" }))
      expect(registry.getExecutableTool("bedroom", "nonexistent")).toBeUndefined()
    })
  })

  describe("room state", () => {
    test("initializes state for rooms with stateSchema", () => {
      registry.register(makeRoom({
        id: "garden",
        name: "Garden",
        stateSchema: z.object({ plants: z.number() }),
      }))
      expect(registry.getRoomState("garden")).toEqual({})
    })

    test("updates and retrieves room state", () => {
      registry.register(makeRoom({
        id: "garden",
        name: "Garden",
        stateSchema: z.object({ plants: z.number() }),
      }))
      registry.updateRoomState("garden", { plants: 5 })
      expect(registry.getRoomState("garden")).toEqual({ plants: 5 })
    })

    test("merges state updates", () => {
      registry.register(makeRoom({
        id: "garden",
        name: "Garden",
        stateSchema: z.object({ plants: z.number() }),
      }))
      registry.updateRoomState("garden", { plants: 5 })
      registry.updateRoomState("garden", { watered: true })
      expect(registry.getRoomState("garden")).toEqual({ plants: 5, watered: true })
    })

    test("returns undefined for rooms without state", () => {
      registry.register(makeRoom({ id: "bedroom", name: "Bedroom" }))
      expect(registry.getRoomState("bedroom")).toBeUndefined()
    })
  })

  describe("lifecycle hooks", () => {
    test("executes onEnter hook", async () => {
      let entered = false
      registry.register({
        id: "bedroom",
        name: "Bedroom",
        description: "A bedroom.",
        tools: [],
        transitions: "*",
        onEnter: async () => {
          entered = true
          return "Welcome to the bedroom."
        },
      })

      const result = await registry.executeOnEnter("bedroom", makeContext("bedroom"))
      expect(entered).toBe(true)
      expect(result).toBe("Welcome to the bedroom.")
    })

    test("executes onExit hook", async () => {
      let exited = false
      registry.register({
        id: "bedroom",
        name: "Bedroom",
        description: "A bedroom.",
        tools: [],
        transitions: "*",
        onExit: async () => {
          exited = true
        },
      })

      await registry.executeOnExit("bedroom", makeContext("bedroom"))
      expect(exited).toBe(true)
    })

    test("returns undefined when no onEnter hook", async () => {
      registry.register(makeRoom({ id: "bedroom", name: "Bedroom" }))
      const result = await registry.executeOnEnter("bedroom", makeContext("bedroom"))
      expect(result).toBeUndefined()
    })
  })
})
