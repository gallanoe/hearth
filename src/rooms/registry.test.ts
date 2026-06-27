import { test, expect, describe, beforeEach } from "bun:test"
import { RoomRegistry } from "./registry"
import { RoomDecorationStore } from "../data/decorations"
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
    registry = new RoomRegistry(new RoomDecorationStore())
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

  describe("getStaticToolDefinitions", () => {
    test("is the fixed dispatch + universal set and never leaks room tools", () => {
      const sleep = {
        name: "sleep",
        description: "Go to sleep.",
        inputSchema: z.object({}),
        execute: async () => ({ success: true, output: "" }),
      }
      const bash = {
        name: "bash",
        description: "Run a command.",
        inputSchema: z.object({}),
        execute: async () => ({ success: true, output: "" }),
      }
      registry.register(makeRoom({ id: "bedroom", name: "Bedroom", tools: [sleep] }))
      registry.register(makeRoom({ id: "office", name: "Office", tools: [bash] }))

      const names = registry.getStaticToolDefinitions().map((d) => d.name)

      // The static wrappers + universal tools are present...
      expect(names).toContain("execute_room_tool")
      expect(names).toContain("get_room_tool_def")
      expect(names).toContain("move_to")
      expect(names).toContain("remember")
      // ...and no room-specific tool ever appears in the advertised (cached) set.
      expect(names).not.toContain("sleep")
      expect(names).not.toContain("bash")
    })
  })

  describe("getRoomToolDefinition", () => {
    test("returns a single room tool's definition, scoped to that room", () => {
      const bash = {
        name: "bash",
        description: "Run a command.",
        inputSchema: z.object({ cmd: z.string() }),
        execute: async () => ({ success: true, output: "" }),
      }
      registry.register(makeRoom({ id: "office", name: "Office", tools: [bash] }))

      const def = registry.getRoomToolDefinition("office", "bash")
      expect(def).toBeDefined()
      expect(def!.name).toBe("bash")
      expect(def!.description).toBe("Run a command.")
    })

    test("returns undefined for universal tools, unknown tools, or the wrong room", () => {
      const bash = {
        name: "bash",
        description: "Run a command.",
        inputSchema: z.object({}),
        execute: async () => ({ success: true, output: "" }),
      }
      registry.register(makeRoom({ id: "office", name: "Office", tools: [bash] }))
      registry.register(makeRoom({ id: "library", name: "Library" }))

      expect(registry.getRoomToolDefinition("office", "move_to")).toBeUndefined()
      expect(registry.getRoomToolDefinition("office", "nonexistent")).toBeUndefined()
      expect(registry.getRoomToolDefinition("library", "bash")).toBeUndefined()
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

  describe("execute_room_tool wrapper", () => {
    test("dispatches to the current room's tool and validates its args", async () => {
      let received: unknown = null
      const echo = {
        name: "echo",
        description: "Echo a message.",
        inputSchema: z.object({ message: z.string() }),
        execute: async (params: Record<string, unknown>) => {
          received = params.message
          return { success: true, output: `echoed: ${params.message}` }
        },
      }
      registry.register(makeRoom({ id: "office", name: "Office", tools: [echo] }))

      const wrapper = registry.getExecutableTool("office", "execute_room_tool")!
      const ctx = makeContext("office")

      const ok = await wrapper.execute({ tool_name: "echo", args: { message: "hi" } }, ctx)
      expect(ok.success).toBe(true)
      expect(received).toBe("hi")

      // Bad inner args are rejected by the inner tool's schema, surfaced clearly.
      const bad = await wrapper.execute({ tool_name: "echo", args: {} }, ctx)
      expect(bad.success).toBe(false)
      expect(bad.output).toContain("Invalid arguments for echo")
    })

    test("refuses a tool that belongs to another room, pointing the way", async () => {
      const bash = {
        name: "bash",
        description: "Run a command.",
        inputSchema: z.object({}),
        execute: async () => ({ success: true, output: "" }),
      }
      registry.register(makeRoom({ id: "office", name: "Office", tools: [bash] }))
      registry.register(makeRoom({ id: "library", name: "Library" }))

      const wrapper = registry.getExecutableTool("library", "execute_room_tool")!
      const result = await wrapper.execute({ tool_name: "bash" }, makeContext("library"))
      expect(result.success).toBe(false)
      expect(result.output).toContain("Office")
    })
  })

  describe("getToolForPersistence", () => {
    test("resolves an execute_room_tool envelope to the inner room tool's flags", () => {
      const bash = {
        name: "bash",
        description: "Run a command.",
        inputSchema: z.object({}),
        persistResult: false,
        execute: async () => ({ success: true, output: "" }),
      }
      registry.register(makeRoom({ id: "office", name: "Office", tools: [bash] }))

      const inner = registry.getToolForPersistence("office", "execute_room_tool", { tool_name: "bash" })
      expect(inner?.name).toBe("bash")
      expect(inner?.persistResult).toBe(false)

      // Direct (non-wrapper) calls resolve to the tool itself.
      const direct = registry.getToolForPersistence("office", "move_to", {})
      expect(direct?.name).toBe("move_to")
    })
  })

  describe("getRoomToolNames", () => {
    test("returns only the current room's tools, not universal ones", () => {
      const officeTool = {
        name: "bash",
        description: "Run a command.",
        inputSchema: z.object({}),
        execute: async () => ({ success: true, output: "" }),
      }
      registry.register(makeRoom({ id: "office", name: "Office", tools: [officeTool] }))

      expect(registry.getRoomToolNames("office")).toEqual(["bash"])
    })

    test("returns empty for a room with no tools or an unknown room", () => {
      registry.register(makeRoom({ id: "entryway", name: "Entryway" }))
      expect(registry.getRoomToolNames("entryway")).toEqual([])
      expect(registry.getRoomToolNames("nonexistent")).toEqual([])
    })
  })

  describe("getRoomsForTool", () => {
    test("names the rooms that define a tool", () => {
      const bash = {
        name: "bash",
        description: "Run a command.",
        inputSchema: z.object({}),
        execute: async () => ({ success: true, output: "" }),
      }
      registry.register(makeRoom({ id: "office", name: "Office", tools: [bash] }))
      registry.register(makeRoom({ id: "library", name: "Library" }))

      expect(registry.getRoomsForTool("bash")).toEqual(["Office"])
      // Unknown / universal tools belong to no room.
      expect(registry.getRoomsForTool("move_to")).toEqual([])
      expect(registry.getRoomsForTool("nonexistent")).toEqual([])
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
