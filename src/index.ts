import { OpenRouterProvider, OpenRouterProviderV2 } from "./llm/openrouter"
import { initializeRooms } from "./rooms"
import { runDay, type DayConfig, type DayResult } from "./core/loop"
import { letterStore } from "./data/letters"

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

initializeRooms()

// State
let currentDay = 0
let isRunning = false
let lastResult: DayResult | null = null

// Default budget config
const defaultBudget = {
  totalTokens: 50_000,
  warningThreshold: 10_000,
}

const server = Bun.serve({
  port: 3000,

  routes: {
    "/api/status": {
      GET: () =>
        Response.json({
          status: isRunning ? "awake" : "asleep",
          currentDay,
          lastResult: lastResult
            ? {
                endReason: lastResult.endReason,
                totalTokensUsed: lastResult.totalTokensUsed,
                turns: lastResult.turns.length,
                intentions: lastResult.intentions,
              }
            : null,
        }),
    },

    "/api/wake": {
      POST: () => {
        if (isRunning) {
          return Response.json({ error: "Agent is already awake" }, { status: 400 })
        }

        isRunning = true
        currentDay++

        const dayConfig: DayConfig = {
          dayNumber: currentDay,
          budget: defaultBudget,
          intentions: lastResult?.intentions ?? null,
          reflections: [],
          inboxCount: letterStore.getUnreadCount(),
        }
        
        // Fire and forget - run day asynchronously
        runDay(llm, dayConfig)
          .then((result) => {
            lastResult = result
            isRunning = false
            console.log(`\n✅ Day ${currentDay} completed: ${result.endReason}`)
          })
          .catch((error) => {
            isRunning = false
            console.error("Error running day:", error)
          })

        // Return immediately
        return Response.json({
          success: true,
          message: "Agent is waking up",
          day: currentDay,
        })
      },
    },

    "/api/inbox": {
      GET: () => {
        const letters = letterStore.getInbox().map((l) => ({
          id: l.id,
          content: l.content,
          sentAt: l.sentAt.toISOString(),
          readAt: l.readAt?.toISOString() ?? null,
        }))
        return Response.json({ letters })
      },
      POST: async (req) => {
        const body = (await req.json()) as { content: string }
        if (!body.content || body.content.trim().length === 0) {
          return Response.json({ error: "Content is required" }, { status: 400 })
        }
        const letter = letterStore.addInbound(body.content.trim())
        return Response.json({
          id: letter.id,
          sentAt: letter.sentAt.toISOString(),
        })
      },
    },

    "/api/outbox": {
      GET: () => {
        const letters = letterStore.getOutbox().map((l) => ({
          id: l.id,
          content: l.content,
          sentAt: l.sentAt.toISOString(),
          readAt: l.readAt?.toISOString() ?? null,
        }))
        return Response.json({ letters })
      },
    },

    "/api/outbox/:id": {
      DELETE: (req) => {
        const letter = letterStore.markOutboundPickedUp(req.params.id)
        if (!letter) {
          return Response.json({ error: "Letter not found" }, { status: 404 })
        }
        return Response.json({
          id: letter.id,
          pickedUpAt: new Date().toISOString(),
        })
      },
    },

    "/api/days/:id": {
      GET: (req) => {
        // TODO: fetch day log from db
        return Response.json({ id: req.params.id, turns: [] })
      },
    },

    "/api/*": Response.json({ message: "Not found" }, { status: 404 }),
  },

  fetch(req) {
    return new Response("Not found", { status: 404 })
  },
})

console.log(`🏠 Hearth listening on port ${server.port}`)