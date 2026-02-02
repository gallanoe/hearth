import { test, expect, describe, beforeEach } from "bun:test"
import { createDecorateRoom, type RoomLookup } from "./decorations"
import { roomDecorationStore } from "../data/decorations"
import type { AgentContext, Room } from "../types/rooms"

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
    description: "A cozy bedroom with a soft bed.",
    tools: [],
    transitions: "*",
  },
}

const lookup: RoomLookup = {
  get(roomId: string): Room | undefined {
    return rooms[roomId]
  },
}

describe("decorate_room tool", () => {
  const decorateRoom = createDecorateRoom(lookup)

  beforeEach(() => {
    roomDecorationStore.clearAll()
  })

  test("has correct name", () => {
    expect(decorateRoom.name).toBe("decorate_room")
  })

  describe("view", () => {
    test("shows default description when not decorated", async () => {
      const ctx = makeContext("bedroom")
      const result = await decorateRoom.execute({ action: "view" }, ctx)
      expect(result.success).toBe(true)
      expect(result.output).toContain("default")
      expect(result.output).toContain("A cozy bedroom with a soft bed.")
    })

    test("shows decorated description when decorated", async () => {
      roomDecorationStore.setDecoration("bedroom", "A moonlit chamber.")
      const ctx = makeContext("bedroom")
      const result = await decorateRoom.execute({ action: "view" }, ctx)
      expect(result.success).toBe(true)
      expect(result.output).toContain("decorated")
      expect(result.output).toContain("A moonlit chamber.")
    })
  })

  describe("decorate", () => {
    test("sets a new decoration", async () => {
      const ctx = makeContext("bedroom")
      const result = await decorateRoom.execute(
        { action: "decorate", newDescription: "A moonlit chamber." },
        ctx
      )
      expect(result.success).toBe(true)
      expect(result.output).toContain("decorated")
      expect(roomDecorationStore.isDecorated("bedroom")).toBe(true)
    })

    test("fails with empty description", async () => {
      const ctx = makeContext("bedroom")
      const result = await decorateRoom.execute(
        { action: "decorate", newDescription: "" },
        ctx
      )
      expect(result.success).toBe(false)
      expect(result.output).toContain("empty")
    })

    test("fails with undefined description", async () => {
      const ctx = makeContext("bedroom")
      const result = await decorateRoom.execute(
        { action: "decorate" },
        ctx
      )
      expect(result.success).toBe(false)
    })
  })

  describe("reset", () => {
    test("removes decoration and restores default", async () => {
      roomDecorationStore.setDecoration("bedroom", "Custom description.")
      const ctx = makeContext("bedroom")
      const result = await decorateRoom.execute({ action: "reset" }, ctx)
      expect(result.success).toBe(true)
      expect(result.output).toContain("removed")
      expect(result.output).toContain("A cozy bedroom with a soft bed.")
      expect(roomDecorationStore.isDecorated("bedroom")).toBe(false)
    })

    test("reports no changes when not decorated", async () => {
      const ctx = makeContext("bedroom")
      const result = await decorateRoom.execute({ action: "reset" }, ctx)
      expect(result.success).toBe(true)
      expect(result.output).toContain("already has its original")
    })
  })

  test("fails for unknown room", async () => {
    const ctx = makeContext("garage")
    const result = await decorateRoom.execute({ action: "view" }, ctx)
    expect(result.success).toBe(false)
    expect(result.output).toContain("Could not find")
  })
})
