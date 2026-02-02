import { test, expect, describe } from "bun:test"
import { createMoveTo, type RoomNavigator } from "./navigation"
import type { AgentContext, Room } from "../types/rooms"
import { z } from "zod"

function makeContext(currentRoom: string): AgentContext {
  return {
    currentRoom,
    currentSession: 1,
    budget: { total: 1_000_000, spent: 0, remaining: 1_000_000, warningThreshold: 200_000 },
    signals: { requestedSleep: false, requestedMove: null },
  }
}

const rooms: Record<string, Room> = {
  bedroom: {
    id: "bedroom",
    name: "Bedroom",
    description: "A cozy bedroom.",
    tools: [],
    transitions: "*",
  },
  office: {
    id: "office",
    name: "Office",
    description: "A workspace.",
    tools: [],
    transitions: ["bedroom", "library"],
  },
  library: {
    id: "library",
    name: "Library",
    description: "A room with books.",
    tools: [],
    transitions: ["office"],
  },
}

const navigator: RoomNavigator = {
  canTransition(from: string, to: string): boolean {
    const room = rooms[from]
    if (!room) return false
    if (room.transitions === "*") return to !== from && !!rooms[to]
    return (room.transitions as string[]).includes(to)
  },
  getAllRoomIds(): string[] {
    return Object.keys(rooms)
  },
  get(roomId: string): Room | undefined {
    return rooms[roomId]
  },
}

describe("move_to tool", () => {
  const moveTo = createMoveTo(navigator)

  test("has correct name and description", () => {
    expect(moveTo.name).toBe("move_to")
    expect(moveTo.description).toContain("Move")
  })

  test("succeeds for valid transition", async () => {
    const ctx = makeContext("office")
    const result = await moveTo.execute({ room: "bedroom" }, ctx)
    expect(result.success).toBe(true)
    expect(result.output).toContain("Bedroom")
    expect(ctx.signals.requestedMove).toBe("bedroom")
  })

  test("succeeds with wildcard transitions", async () => {
    const ctx = makeContext("bedroom")
    const result = await moveTo.execute({ room: "office" }, ctx)
    expect(result.success).toBe(true)
    expect(ctx.signals.requestedMove).toBe("office")
  })

  test("fails for invalid transition", async () => {
    const ctx = makeContext("library")
    const result = await moveTo.execute({ room: "bedroom" }, ctx)
    expect(result.success).toBe(false)
    expect(result.output).toContain("Cannot move")
    expect(result.output).toContain("office")
    expect(ctx.signals.requestedMove).toBeNull()
  })

  test("fails for nonexistent room", async () => {
    const ctx = makeContext("office")
    const result = await moveTo.execute({ room: "garage" }, ctx)
    expect(result.success).toBe(false)
    expect(result.output).toContain("Cannot move")
  })

  test("does not set signal on failure", async () => {
    const ctx = makeContext("library")
    await moveTo.execute({ room: "bedroom" }, ctx)
    expect(ctx.signals.requestedMove).toBeNull()
  })
})
