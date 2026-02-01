import { OpenRouterProvider, OpenRouterProviderV2 } from "./llm/openrouter"
import { initializeRooms } from "./rooms"
import { runSession, type SessionConfig, type SessionResult } from "./core/loop"
import { letterStore } from "./data/letters"
import { runMigrations, isDatabaseAvailable } from "./data/db"
import { sessionStore } from "./data/sessions"

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

// State - in-memory tracking for running session
let isRunning = false
let lastResult: SessionResult | null = null // Fallback for when DB is unavailable

// Default budget config
const defaultBudget = {
  totalTokens: 1_000_000,
  warningThreshold: 100_000,
}

const server = Bun.serve({
  port: 3000,

  routes: {
    "/api/status": {
      GET: async () => {
        // Get current session info from database if available
        const sessions = await sessionStore.listSessions()
        const latestSession = sessions[0] ?? null
        const currentSession = latestSession?.sessionId ?? 0

        return Response.json({
          status: isRunning ? "awake" : "asleep",
          currentSession,
          databaseConnected: isDatabaseAvailable(),
          lastResult: latestSession
            ? {
                endReason: latestSession.endReason,
                totalTokensUsed: latestSession.totalTokensUsed,
                intentions: latestSession.intentions,
                sessionSummary: latestSession.sessionSummary,
              }
            : lastResult
              ? {
                  endReason: lastResult.endReason,
                  totalTokensUsed: lastResult.totalTokensUsed,
                  turns: lastResult.turns.length,
                  intentions: lastResult.intentions,
                  sessionSummary: lastResult.sessionSummary,
                }
              : null,
        })
      },
    },

    "/api/wake": {
      POST: async () => {
        if (isRunning) {
          return Response.json({ error: "Agent is already awake" }, { status: 400 })
        }

        // Get next session number from database or fallback to in-memory
        const nextSessionNumber = await sessionStore.getNextSessionNumber()

        // Send welcome letter on first session
        if (nextSessionNumber === 1) {
          letterStore.sendWelcomeLetterIfFirstSession()
        }

        isRunning = true

        // Get previous session data from database
        const previousIntentions = await sessionStore.getPreviousIntentions()
        const previousSessionSummary = await sessionStore.getPreviousSessionSummary()

        const sessionConfig: SessionConfig = {
          sessionNumber: nextSessionNumber,
          budget: defaultBudget,
          intentions: previousIntentions ?? lastResult?.intentions ?? null,
          reflections: [],
          inboxCount: letterStore.getUnreadCount(),
          previousSessionSummary: previousSessionSummary ?? lastResult?.sessionSummary ?? null,
        }

        // Fire and forget - run session asynchronously
        runSession(llm, sessionConfig, sessionStore)
          .then((result) => {
            lastResult = result
            isRunning = false
            console.log(`\n✅ Session ${nextSessionNumber} completed: ${result.endReason}`)
          })
          .catch((error) => {
            isRunning = false
            console.error("Error running session:", error)
          })

        // Return immediately
        return Response.json({
          success: true,
          message: "Agent is waking up",
          session: nextSessionNumber,
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

    "/api/outbox/:id/pickup": {
      POST: (req) => {
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

    "/api/sessions": {
      GET: async () => {
        const sessions = await sessionStore.listSessions()
        return Response.json({
          sessions: sessions.map((s) => ({
            id: s.sessionId,
            startedAt: s.startedAt.toISOString(),
            endedAt: s.endedAt?.toISOString() ?? null,
            endReason: s.endReason,
            totalTokensUsed: s.totalTokensUsed,
            intentions: s.intentions,
            sessionSummary: s.sessionSummary,
          })),
        })
      },
    },

    "/api/sessions/:id": {
      GET: async (req) => {
        const sessionId = parseInt(req.params.id, 10)
        if (isNaN(sessionId)) {
          return Response.json({ error: "Invalid session ID" }, { status: 400 })
        }

        const sessionInfo = await sessionStore.getSessionInfo(sessionId)
        if (!sessionInfo) {
          return Response.json({ error: "Session not found" }, { status: 404 })
        }

        const transcript = await sessionStore.getFullTranscript(sessionId)

        return Response.json({
          id: sessionInfo.sessionId,
          startedAt: sessionInfo.startedAt.toISOString(),
          endedAt: sessionInfo.endedAt?.toISOString() ?? null,
          endReason: sessionInfo.endReason,
          totalTokensUsed: sessionInfo.totalTokensUsed,
          intentions: sessionInfo.intentions,
          sessionSummary: sessionInfo.sessionSummary,
          messages: transcript.map((m) => ({
            id: m.messageId,
            sequenceNum: m.sequenceNum,
            role: m.role,
            content: m.content,
            toolCalls: m.toolCalls,
            toolCallId: m.toolCallId,
            status: m.status,
            compactionId: m.compactionId,
            room: m.room,
            turnSequence: m.turnSequence,
            createdAt: m.createdAt.toISOString(),
          })),
        })
      },
    },

    "/api/*": Response.json({ message: "Not found" }, { status: 404 }),
  },

  fetch(req) {
    return new Response("Not found", { status: 404 })
  },
})

console.log(`🏠 Hearth listening on port ${server.port}`)