import { test, expect, describe } from "bun:test"
import {
  buildSystemPrompt,
  buildWakeUpMessage,
  buildRoomEntryMessage,
  buildNotificationMessage,
} from "./context"
import type { BudgetState } from "./budget"
import type { Room } from "../types/rooms"
import { PersonaStore } from "../data/persona"
import { RoomDecorationStore } from "../data/decorations"
import { z } from "zod"

const persona = new PersonaStore()
const decorations = new RoomDecorationStore()

function makeBudget(overrides: Partial<BudgetState> = {}): BudgetState {
  return {
    total: 1_000_000,
    spent: 0,
    remaining: 1_000_000,
    warningThreshold: 200_000,
    warningIssued: false,
    totalCost: 0,
    ...overrides,
  }
}

function makeRoom(overrides: Partial<Room> = {}): Room {
  return {
    id: "bedroom",
    name: "Bedroom",
    description: "A cozy bedroom.",
    tools: [],
    transitions: "*",
    ...overrides,
  }
}

describe("buildSystemPrompt", () => {
  test("includes persona and mechanics", () => {
    const prompt = buildSystemPrompt(makeBudget(), persona)
    expect(prompt).toContain("Mechanics:")
    expect(prompt).toContain("move_to")
    expect(prompt).toContain("Budget:")
  })

  test("shows budget warning when low", () => {
    const prompt = buildSystemPrompt(makeBudget({
      spent: 900_000,
      remaining: 100_000,
    }), persona)
    expect(prompt).toContain("BUDGET LOW")
    expect(prompt).toContain("wrapping up")
  })

  test("shows normal budget when healthy", () => {
    const prompt = buildSystemPrompt(makeBudget({
      spent: 100_000,
      remaining: 900_000,
    }), persona)
    expect(prompt).not.toContain("BUDGET LOW")
    expect(prompt).toContain("Budget:")
  })
})

describe("buildWakeUpMessage", () => {
  test("includes session number and room description", () => {
    const msg = buildWakeUpMessage({
      session: 5,
      budget: makeBudget(),
      currentRoom: makeRoom(),
      reflections: [],
      inboxCount: 0,
      previousSessionSummary: null,
      memoryCount: 0,
      pendingTodoCount: 0,
    }, decorations)
    expect(msg).toContain("Session 5")
    expect(msg).toContain("A cozy bedroom.")
    expect(msg).toContain("1000k tokens")
  })

  test("includes previous session summary when present", () => {
    const msg = buildWakeUpMessage({
      session: 2,
      budget: makeBudget(),
      currentRoom: makeRoom(),
      reflections: [],
      inboxCount: 0,
      previousSessionSummary: "Agent read a book and went to sleep.",
      memoryCount: 0,
      pendingTodoCount: 0,
    }, decorations)
    expect(msg).toContain("Summary of last session")
    expect(msg).toContain("read a book")
  })

  test("includes inbox count when > 0", () => {
    const msg = buildWakeUpMessage({
      session: 1,
      budget: makeBudget(),
      currentRoom: makeRoom(),
      reflections: [],
      inboxCount: 3,
      previousSessionSummary: null,
      memoryCount: 0,
      pendingTodoCount: 0,
    }, decorations)
    expect(msg).toContain("3 unread letters")
  })

  test("uses singular 'letter' for 1 message", () => {
    const msg = buildWakeUpMessage({
      session: 1,
      budget: makeBudget(),
      currentRoom: makeRoom(),
      reflections: [],
      inboxCount: 1,
      previousSessionSummary: null,
      memoryCount: 0,
      pendingTodoCount: 0,
    }, decorations)
    expect(msg).toContain("1 unread letter")
  })

  test("includes memory count when > 0", () => {
    const msg = buildWakeUpMessage({
      session: 1,
      budget: makeBudget(),
      currentRoom: makeRoom(),
      reflections: [],
      inboxCount: 0,
      previousSessionSummary: null,
      memoryCount: 7,
      pendingTodoCount: 0,
    }, decorations)
    expect(msg).toContain("7 stored memories")
  })

  test("omits inbox and memory sections when zero", () => {
    const msg = buildWakeUpMessage({
      session: 1,
      budget: makeBudget(),
      currentRoom: makeRoom(),
      reflections: [],
      inboxCount: 0,
      previousSessionSummary: null,
      memoryCount: 0,
      pendingTodoCount: 0,
    }, decorations)
    expect(msg).not.toContain("unread")
    expect(msg).not.toContain("stored memor")
  })

  test("includes pending todo count when > 0", () => {
    const msg = buildWakeUpMessage({
      session: 1,
      budget: makeBudget(),
      currentRoom: makeRoom(),
      reflections: [],
      inboxCount: 0,
      previousSessionSummary: null,
      memoryCount: 0,
      pendingTodoCount: 3,
    }, decorations)
    expect(msg).toContain("3 pending todos")
  })

  test("uses singular 'todo' for 1 todo", () => {
    const msg = buildWakeUpMessage({
      session: 1,
      budget: makeBudget(),
      currentRoom: makeRoom(),
      reflections: [],
      inboxCount: 0,
      previousSessionSummary: null,
      memoryCount: 0,
      pendingTodoCount: 1,
    }, decorations)
    expect(msg).toContain("1 pending todo.")
  })

  test("omits todo section when zero", () => {
    const msg = buildWakeUpMessage({
      session: 1,
      budget: makeBudget(),
      currentRoom: makeRoom(),
      reflections: [],
      inboxCount: 0,
      previousSessionSummary: null,
      memoryCount: 0,
      pendingTodoCount: 0,
    }, decorations)
    expect(msg).not.toContain("pending todo")
  })

})

describe("buildRoomEntryMessage", () => {
  test("includes room name and description", () => {
    const room = makeRoom({
      id: "library",
      name: "Library",
      description: "A room full of books.",
    })
    const msg = buildRoomEntryMessage(room, decorations)
    expect(msg).toContain("Library")
    expect(msg).toContain("A room full of books.")
  })

  test("lists available tools", () => {
    const room = makeRoom({
      tools: [{
        name: "read_book",
        description: "Read a book.",
        inputSchema: z.object({}),
        execute: async () => ({ success: true, output: "" }),
      }],
    })
    const msg = buildRoomEntryMessage(room, decorations)
    expect(msg).toContain("read_book: Read a book.")
    // Universal tools always listed
    expect(msg).toContain("move_to")
    expect(msg).toContain("remember")
    expect(msg).toContain("todo")
  })

  test("includes extra context when provided", () => {
    const msg = buildRoomEntryMessage(makeRoom(), decorations, "The bed looks inviting.")
    expect(msg).toContain("The bed looks inviting.")
  })
})

describe("buildNotificationMessage", () => {
  test("returns null when no notifications", () => {
    expect(buildNotificationMessage({}, decorations)).toBeNull()
  })

  test("includes room entry when present", () => {
    const msg = buildNotificationMessage({
      roomEntry: {
        room: makeRoom({ id: "office", name: "Office", description: "A workspace." }),
        enterMessage: "The terminal hums.",
      },
    }, decorations)
    expect(msg).not.toBeNull()
    expect(msg).toContain("Office")
    expect(msg).toContain("The terminal hums.")
  })

  test("includes budget warning when low", () => {
    const msg = buildNotificationMessage({
      budgetWarning: {
        remaining: 50_000,
        total: 1_000_000,
        percentRemaining: 5,
      },
    }, decorations)
    expect(msg).not.toBeNull()
    expect(msg).toContain("Budget warning")
    expect(msg).toContain("5%")
  })

  test("does not show budget warning above 20%", () => {
    const msg = buildNotificationMessage({
      budgetWarning: {
        remaining: 300_000,
        total: 1_000_000,
        percentRemaining: 30,
      },
    }, decorations)
    expect(msg).toBeNull()
  })

  test("includes inbox notification", () => {
    const msg = buildNotificationMessage({
      inboxCount: 2,
    }, decorations)
    expect(msg).not.toBeNull()
    expect(msg).toContain("2 unread letters")
  })

  test("combines multiple notifications", () => {
    const msg = buildNotificationMessage({
      roomEntry: {
        room: makeRoom({ id: "office", name: "Office", description: "A workspace." }),
      },
      inboxCount: 1,
    }, decorations)
    expect(msg).toContain("Office")
    expect(msg).toContain("1 unread letter")
  })
})
