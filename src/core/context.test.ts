import { test, expect, describe } from "bun:test"
import {
  buildSystemPrompt,
  buildWakeUpMessage,
  buildRoomEntryMessage,
  buildNotificationMessage,
} from "./context"
import type { Room } from "../types/rooms"
import { PersonaStore } from "../data/persona"
import { RoomDecorationStore } from "../data/decorations"
import { z } from "zod"

const persona = new PersonaStore()
const decorations = new RoomDecorationStore()

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
    const prompt = buildSystemPrompt(persona)
    expect(prompt).toContain("Mechanics:")
    expect(prompt).toContain("move_to")
  })

  test("does not surface the token budget to the agent", () => {
    // The agent is never told about its token budget; the budget is tracked
    // internally only.
    const prompt = buildSystemPrompt(persona)
    expect(prompt).not.toContain("Budget")
    expect(prompt).not.toContain("budget")
    expect(prompt).not.toContain("token")
  })

  test("lists the always-available universal tools", () => {
    const prompt = buildSystemPrompt(persona)
    expect(prompt).toContain("Always available")
    for (const tool of ["move_to", "decorate_room", "remember", "recall", "forget", "todo", "get_room_tool_def"]) {
      expect(prompt).toContain(tool)
    }
  })
})

describe("buildWakeUpMessage", () => {
  test("includes session number and room description", () => {
    const msg = buildWakeUpMessage({
      session: 5,
      currentRoom: makeRoom(),
      reflections: [],
      inboxCount: 0,
      previousSessionSummary: null,
      memoryCount: 0,
      pendingTodoCount: 0,
    }, decorations)
    expect(msg).toContain("Session 5")
    expect(msg).toContain("A cozy bedroom.")
  })

  test("does not surface the token budget to the agent", () => {
    const msg = buildWakeUpMessage({
      session: 1,
      currentRoom: makeRoom(),
      reflections: [],
      inboxCount: 0,
      previousSessionSummary: null,
      memoryCount: 0,
      pendingTodoCount: 0,
    }, decorations)
    expect(msg).not.toContain("budget")
    expect(msg).not.toContain("token")
  })

  test("includes previous session summary when present", () => {
    const msg = buildWakeUpMessage({
      session: 2,
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

  test("lists the room's own tools (universal tools live in the system prompt)", () => {
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
    // Universal tools are no longer repeated per room — they're in the system prompt.
    expect(msg).not.toContain("move_to")
    expect(msg).not.toContain("remember")
  })

  test("omits the tools section for a room with no tools", () => {
    const msg = buildRoomEntryMessage(makeRoom({ tools: [] }), decorations)
    expect(msg).not.toContain("Tools in this room")
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
