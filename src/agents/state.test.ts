import { test, expect, describe } from "bun:test"
import { createAgentState, type AgentState } from "./state"
import { LocalWorkspace } from "../workspace/local"
import { mkdtemp, rm, realpath } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { LetterStore } from "../data/letters"
import { PersonaStore } from "../data/persona"
import { RoomDecorationStore } from "../data/decorations"
import { ReflectionStore } from "../data/reflections"
import { BookStore } from "../data/books"
import { SessionStore } from "../data/sessions"
import { MemoryStore } from "../data/memories"
import { PlanStore } from "../data/plans"
import { RoomRegistry } from "../rooms/registry"

describe("createAgentState", () => {
  let tmpDir: string
  let workspace: LocalWorkspace

  test("returns an AgentState with the correct agentId", async () => {
    tmpDir = await realpath(await mkdtemp(join(tmpdir(), "hearth-state-test-")))
    workspace = new LocalWorkspace(tmpDir)

    const state = await createAgentState("test-agent", workspace)

    expect(state.agentId).toBe("test-agent")
    expect(state.workspace).toBe(workspace)

    await rm(tmpDir, { recursive: true, force: true })
  })

  test("creates independent store instances", async () => {
    tmpDir = await realpath(await mkdtemp(join(tmpdir(), "hearth-state-test-")))
    workspace = new LocalWorkspace(tmpDir)

    const state = await createAgentState("agent-1", workspace)

    expect(state.stores.letters).toBeInstanceOf(LetterStore)
    expect(state.stores.persona).toBeInstanceOf(PersonaStore)
    expect(state.stores.decorations).toBeInstanceOf(RoomDecorationStore)
    expect(state.stores.reflections).toBeInstanceOf(ReflectionStore)
    expect(state.stores.books).toBeInstanceOf(BookStore)
    expect(state.stores.sessions).toBeInstanceOf(SessionStore)
    expect(state.stores.memories).toBeInstanceOf(MemoryStore)
    expect(state.stores.plans).toBeInstanceOf(PlanStore)

    await rm(tmpDir, { recursive: true, force: true })
  })

  test("creates a RoomRegistry with rooms registered", async () => {
    tmpDir = await realpath(await mkdtemp(join(tmpdir(), "hearth-state-test-")))
    workspace = new LocalWorkspace(tmpDir)

    const state = await createAgentState("agent-rooms", workspace)

    expect(state.roomRegistry).toBeInstanceOf(RoomRegistry)
    // All four rooms should be registered
    expect(state.roomRegistry.get("bedroom")).toBeDefined()
    expect(state.roomRegistry.get("entryway")).toBeDefined()
    expect(state.roomRegistry.get("library")).toBeDefined()
    expect(state.roomRegistry.get("office")).toBeDefined()

    await rm(tmpDir, { recursive: true, force: true })
  })

  test("two agents have independent stores", async () => {
    tmpDir = await realpath(await mkdtemp(join(tmpdir(), "hearth-state-test-")))
    const ws1 = new LocalWorkspace(tmpDir)
    const ws2 = new LocalWorkspace(tmpDir)

    const state1 = await createAgentState("agent-a", ws1)
    const state2 = await createAgentState("agent-b", ws2)

    // Stores should be separate instances
    expect(state1.stores.letters).not.toBe(state2.stores.letters)
    expect(state1.stores.persona).not.toBe(state2.stores.persona)
    expect(state1.stores.memories).not.toBe(state2.stores.memories)
    expect(state1.roomRegistry).not.toBe(state2.roomRegistry)

    // Mutating one should not affect the other
    state1.stores.letters.addInbound("Hello from agent-a")
    expect(state1.stores.letters.getUnreadCount()).toBe(1)
    expect(state2.stores.letters.getUnreadCount()).toBe(0)

    await rm(tmpDir, { recursive: true, force: true })
  })
})
