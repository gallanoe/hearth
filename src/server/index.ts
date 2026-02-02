import type { LLMProvider } from "../types/llm"
import type { AgentStores } from "../types/rooms"
import type { RoomRegistry } from "../rooms/registry"
import { runSession, type SessionConfig, type SessionResult } from "../core/loop"
import { createRoutes } from "./routes"
import { DEFAULT_BUDGET, SERVER_PORT } from "../config"

/**
 * Creates and starts the Hearth HTTP server.
 */
export function startServer(llm: LLMProvider, stores: AgentStores, registry: RoomRegistry) {
  // State - in-memory tracking for running session
  let isRunning = false
  let lastResult: SessionResult | null = null

  const routes = createRoutes({
    isRunning: () => isRunning,
    lastResult: () => lastResult,
    stores,
  })

  const server = Bun.serve({
    port: SERVER_PORT,

    routes: {
      ...routes,

      // Wake endpoint needs access to LLM and session lifecycle
      "/api/wake": {
        POST: async () => {
          if (isRunning) {
            return Response.json({ error: "Agent is already awake" }, { status: 400 })
          }

          const nextSessionNumber = await stores.sessions.getNextSessionNumber()

          if (nextSessionNumber === 1) {
            stores.letters.sendWelcomeLetterIfFirstSession()
          }

          isRunning = true

          const previousSessionSummary = await stores.sessions.getPreviousSessionSummary()

          const sessionConfig: SessionConfig = {
            sessionNumber: nextSessionNumber,
            budget: DEFAULT_BUDGET,
            reflections: [],
            inboxCount: stores.letters.getUnreadCount(),
            previousSessionSummary: previousSessionSummary ?? lastResult?.sessionSummary ?? null,
          }

          // Fire and forget - run session asynchronously
          runSession(llm, sessionConfig, stores, registry)
            .then((result) => {
              lastResult = result
              isRunning = false
              console.log(`\n✅ Session ${nextSessionNumber} completed: ${result.endReason}`)
            })
            .catch((error) => {
              isRunning = false
              console.error("Error running session:", error)
            })

          return Response.json({
            success: true,
            message: "Agent is waking up",
            session: nextSessionNumber,
          })
        },
      },
    },

    fetch(req) {
      return new Response("Not found", { status: 404 })
    },
  })

  console.log(`🏠 Hearth listening on port ${server.port}`)
  return server
}
