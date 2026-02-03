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
