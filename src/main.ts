import { OpenRouterProviderV2 } from "./llm/openrouter"
import { TracedProvider } from "./observability/traced-provider"
import {
  startObservability,
  shutdownObservability,
  observabilityEnabled,
} from "./observability/instrumentation"
import { runMigrations, isDatabaseAvailable } from "./data/db"
import { startServer } from "./server"
import { AgentManager } from "./agents"

// Start tracing before building the provider so the SDK is registered first.
startObservability()

// Initialize on startup
const apiKey = Bun.env.OPENROUTER_API_KEY
if (!apiKey) {
  console.error("Missing OPENROUTER_API_KEY environment variable")
  process.exit(1)
}

const model = Bun.env.OPENROUTER_MODEL_ID ?? "anthropic/claude-opus-4.5"
const baseProvider = new OpenRouterProviderV2({ apiKey, appName: "Hearth", model })
const llm = observabilityEnabled() ? new TracedProvider(baseProvider, model) : baseProvider

// Flush buffered traces before the process exits.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void shutdownObservability().finally(() => process.exit(0))
  })
}

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
