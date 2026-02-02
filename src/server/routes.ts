import type { SessionResult } from "../core/loop"
import { letterStore } from "../data/letters"
import { sessionStore } from "../data/sessions"

/**
 * Creates all API route handlers.
 * Receives shared state via closure to keep routes testable.
 */
export function createRoutes(state: {
  isRunning: () => boolean
  lastResult: () => SessionResult | null
}) {
  return {
    "/api/status": {
      GET: async () => {
        const sessions = await sessionStore.listSessions()
        const latestSession = sessions[0] ?? null
        const currentSession = latestSession?.sessionId ?? 0
        const last = state.lastResult()

        return Response.json({
          status: state.isRunning() ? "awake" : "asleep",
          currentSession,
          databaseConnected: (await import("../data/db")).isDatabaseAvailable(),
          lastResult: latestSession
            ? {
                endReason: latestSession.endReason,
                totalTokensUsed: latestSession.totalTokensUsed,
                sessionSummary: latestSession.sessionSummary,
              }
            : last
              ? {
                  endReason: last.endReason,
                  totalTokensUsed: last.totalTokensUsed,
                  turns: last.turns.length,
                  sessionSummary: last.sessionSummary,
                }
              : null,
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
      POST: async (req: Request) => {
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
      POST: (req: Request & { params: { id: string } }) => {
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
            sessionSummary: s.sessionSummary,
          })),
        })
      },
    },

    "/api/sessions/:id": {
      GET: async (req: Request & { params: { id: string } }) => {
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
  }
}
