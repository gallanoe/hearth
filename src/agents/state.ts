import type { AgentStores } from "../types/rooms"
import type { Workspace } from "../workspace/types"
import { RoomRegistry } from "../rooms/registry"
import { LetterStore } from "../data/letters"
import { PersonaStore } from "../data/persona"
import { RoomDecorationStore } from "../data/decorations"
import { ReflectionStore } from "../data/reflections"
import { BookStore } from "../data/books"
import { SessionStore } from "../data/sessions"
import { MemoryStore } from "../data/memories"
import { TodoStore } from "../data/todos"
import { sql } from "../data/db"
import { initializeRooms } from "../rooms"

export interface AgentState {
  agentId: string
  workspace: Workspace
  stores: AgentStores
  roomRegistry: RoomRegistry
}

/**
 * Creates a fully initialized AgentState with per-agent store instances
 * and a configured room registry.
 */
export async function createAgentState(
  agentId: string,
  workspace: Workspace
): Promise<AgentState> {
  const stores: AgentStores = {
    letters: new LetterStore(),
    persona: new PersonaStore(),
    decorations: new RoomDecorationStore(),
    reflections: new ReflectionStore(),
    books: new BookStore(),
    sessions: new SessionStore(agentId),
    memories: new MemoryStore(agentId),
    todos: new TodoStore(sql, agentId),
  }

  const roomRegistry = new RoomRegistry(stores.decorations)
  await initializeRooms(roomRegistry, stores.books)

  return { agentId, workspace, stores, roomRegistry }
}
