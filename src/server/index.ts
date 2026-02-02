import type { LLMProvider } from "../types/llm"
import type { AgentStores } from "../types/rooms"
import type { Workspace } from "../workspace/types"
import type { RoomRegistry } from "../rooms/registry"
import { runSession, type SessionConfig, type SessionResult } from "../core/loop"
import { createRoutes } from "./routes"
import { DEFAULT_BUDGET, SERVER_PORT, USE_CONTAINERS, CONTAINER_IMAGE, WORKSPACE_ROOT } from "../config"
import { ContainerProvider } from "../agents/container-provider"
import { ContainerWorkspace } from "../workspace/container"

/**
 * Creates and starts the Hearth HTTP server.
 */
export function startServer(llm: LLMProvider, stores: AgentStores, registry: RoomRegistry) {
  // State - in-memory tracking for running session
  let isRunning = false
  let lastResult: SessionResult | null = null

  // Container provider for Docker-backed workspaces
  const containerProvider = USE_CONTAINERS ? new ContainerProvider() : null

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

          // If containers are enabled, ensure a container is running
          let workspace: Workspace | undefined
          if (containerProvider) {
            try {
              const agentId = "default"
              let containerId = await containerProvider.getContainerId(agentId)
              if (!containerId) {
                // No running container — check if one exists but is stopped
                const info = await containerProvider.getInfo(agentId)
                if (info) {
                  await containerProvider.start(agentId)
                  containerId = info.containerId
                } else {
                  containerId = await containerProvider.create(agentId, CONTAINER_IMAGE)
                }
              }
              workspace = new ContainerWorkspace(containerId, WORKSPACE_ROOT)
              console.log(`🐳 Using container workspace: ${containerId.slice(0, 12)}`)
            } catch (error) {
              isRunning = false
              console.error("Failed to set up container workspace:", error)
              return Response.json(
                { error: "Failed to start container workspace" },
                { status: 500 },
              )
            }
          }

          const previousSessionSummary = await stores.sessions.getPreviousSessionSummary()

          const sessionConfig: SessionConfig = {
            sessionNumber: nextSessionNumber,
            budget: DEFAULT_BUDGET,
            reflections: [],
            inboxCount: stores.letters.getUnreadCount(),
            previousSessionSummary: previousSessionSummary ?? lastResult?.sessionSummary ?? null,
            workspace,
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
            container: !!containerProvider,
          })
        },
      },
    },

    fetch(req) {
      return new Response("Not found", { status: 404 })
    },
  })

  const mode = USE_CONTAINERS ? " (container mode)" : ""
  console.log(`🏠 Hearth listening on port ${server.port}${mode}`)
  return server
}
