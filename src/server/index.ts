import type { LLMProvider } from "../types/llm"
import type { AgentManager } from "../agents/manager"
import { createRoutes } from "./routes"
import { SERVER_PORT, USE_CONTAINERS } from "../config"

/**
 * Creates and starts the Hearth HTTP server.
 */
export function startServer(llm: LLMProvider, manager: AgentManager) {
  const routes = createRoutes(llm, manager)

  const server = Bun.serve({
    port: SERVER_PORT,

    // SSE streams (GET /api/agents/:id/events) keep themselves alive with a ping
    // every 20s. Bun's default idleTimeout is 10s, which closes an otherwise-quiet
    // stream before the next ping arrives — causing the client to reconnect in a
    // loop. Raise it well above the heartbeat interval. (Max allowed is 255s.)
    idleTimeout: 120,

    routes: {
      ...routes,
    },

    fetch(req) {
      return new Response("Not found", { status: 404 })
    },
  })

  const mode = USE_CONTAINERS ? " (container mode)" : ""
  console.log(`🏠 Hearth listening on port ${server.port}${mode}`)
  return server
}
