import { OpenRouterProviderV2 } from "./llm/openrouter"
import { runMigrations, isDatabaseAvailable } from "./data/db"
import { startServer } from "./server"
import { AgentManager } from "./agents"

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

// Create agent manager and default agent
const manager = new AgentManager()
await manager.createAgent("default")

// Start HTTP server
startServer(llm, manager)
