import { OpenRouterProviderV2 } from "./llm/openrouter"
import { initializeRooms } from "./rooms"
import { runMigrations, isDatabaseAvailable } from "./data/db"
import { startServer } from "./server"

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

// Initialize rooms (async for book loading)
await initializeRooms()

// Start HTTP server
startServer(llm)
