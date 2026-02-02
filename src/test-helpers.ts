/**
 * Shared test helpers for constructing AgentContext and other test fixtures.
 */
import type { AgentContext, AgentStores } from "./types/rooms"
import type { Workspace, ExecResult, DirEntry, FileStat } from "./workspace/types"
import { LetterStore } from "./data/letters"
import { PersonaStore } from "./data/persona"
import { RoomDecorationStore } from "./data/decorations"
import { ReflectionStore } from "./data/reflections"
import { BookStore } from "./data/books"
import { SessionStore } from "./data/sessions"
import { MemoryStore } from "./data/memories"
import { PlanStore } from "./data/plans"

/**
 * A no-op workspace stub for tests that don't exercise workspace operations.
 * Throws on any actual call to make unexpected usage obvious.
 */
export const stubWorkspace: Workspace = {
  root: "/test/workspace",
  async exec(): Promise<ExecResult> {
    throw new Error("stubWorkspace.exec() called unexpectedly")
  },
  async readFile(): Promise<string> {
    throw new Error("stubWorkspace.readFile() called unexpectedly")
  },
  async writeFile(): Promise<void> {
    throw new Error("stubWorkspace.writeFile() called unexpectedly")
  },
  async listDir(): Promise<DirEntry[]> {
    throw new Error("stubWorkspace.listDir() called unexpectedly")
  },
  async exists(): Promise<boolean> {
    throw new Error("stubWorkspace.exists() called unexpectedly")
  },
  async stat(): Promise<FileStat> {
    throw new Error("stubWorkspace.stat() called unexpectedly")
  },
}

/**
 * Create a fresh set of agent stores for testing.
 */
export function makeTestStores(overrides: Partial<AgentStores> = {}): AgentStores {
  return {
    letters: new LetterStore(),
    persona: new PersonaStore(),
    decorations: new RoomDecorationStore(),
    reflections: new ReflectionStore(),
    books: new BookStore(),
    sessions: new SessionStore("test"),
    memories: new MemoryStore("test"),
    plans: new PlanStore("test"),
    ...overrides,
  }
}

/**
 * Build an AgentContext for tests.
 */
export function makeTestContext(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    agentId: "test",
    workspace: stubWorkspace,
    stores: makeTestStores(overrides.stores),
    currentRoom: "bedroom",
    currentSession: 1,
    budget: { total: 1_000_000, spent: 0, remaining: 1_000_000, warningThreshold: 200_000 },
    signals: { requestedSleep: false, requestedMove: null },
    ...overrides,
  }
}
