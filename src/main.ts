import { OpenRouterProviderV2 } from "./llm/openrouter"
import { initializeRooms } from "./rooms"
import { RoomRegistry } from "./rooms/registry"
import { runMigrations, isDatabaseAvailable } from "./data/db"
import { startServer } from "./server"
import { LetterStore } from "./data/letters"
import { PersonaStore } from "./data/persona"
import { RoomDecorationStore } from "./data/decorations"
import { ReflectionStore } from "./data/reflections"
import { BookStore } from "./data/books"
import { SessionStore } from "./data/sessions"
import { MemoryStore } from "./data/memories"
import { PlanStore } from "./data/plans"
import type { AgentStores } from "./types/rooms"

// Initialize on startup
const apiKey = Bun.env.OPENROUTER_API_KEY
if (!apiKey) {
  console.error("Missing OPENROUTER_API_KEY environment variable")
  process.exit(1)
}

const llm = new OpenRouterProviderV2({
  apiKey,
  appName: "Hearth",
  model: Bun.env.OPENROUTER_MODEL_ID ?? "anthropic/claude-opus-4.5",
})

// Run database migrations
if (isDatabaseAvailable()) {
  console.log("🗄️  Running database migrations...")
  await runMigrations()
}

// Create default agent stores
const agentId = "default"
const stores: AgentStores = {
  letters: new LetterStore(),
  persona: new PersonaStore(),
  decorations: new RoomDecorationStore(),
  reflections: new ReflectionStore(),
  books: new BookStore(),
  sessions: new SessionStore(agentId),
  memories: new MemoryStore(agentId),
  plans: new PlanStore(agentId),
}

// Create room registry with decoration store
const registry = new RoomRegistry(stores.decorations)

// Initialize rooms (async for book loading)
await initializeRooms(registry, stores.books)

// Start HTTP server
startServer(llm, stores, registry)
