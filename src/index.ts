import { OpenRouterProvider } from "./llm/openrouter"
import { initializeRooms } from "./rooms"
import { runDay, type DayConfig, type DayResult } from "./core/loop"

// Initialize on startup
const apiKey = Bun.env.OPENROUTER_API_KEY
if (!apiKey) {
  console.error("Missing OPENROUTER_API_KEY environment variable")
  process.exit(1)
}

const llm = new OpenRouterProvider({
  apiKey,
  appName: "Hearth",
  model: "anthropic/claude-sonnet-4",
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
      POST: async () => {
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
          inboxCount: 0,
        }

        console.log("\n🏠 Hearth")
        console.log("   A home for AI\n")

        try {
          lastResult = await runDay(llm, dayConfig)
          isRunning = false

          return Response.json({
            success: true,
            day: currentDay,
            endReason: lastResult.endReason,
            totalTokensUsed: lastResult.totalTokensUsed,
            turns: lastResult.turns.length,
            intentions: lastResult.intentions,
          })
        } catch (error) {
          isRunning = false
          console.error("Error running day:", error)
          return Response.json(
            { error: "Day failed", details: String(error) },
            { status: 500 }
          )
        }
      },
    },

    "/api/messages": {
      GET: () => {
        // TODO: fetch from inbox
        return Response.json({ messages: [] })
      },
      POST: async (req) => {
        const body = (await req.json()) as { content: string }
        // TODO: persist to inbox
        return Response.json({ received: true, content: body.content })
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