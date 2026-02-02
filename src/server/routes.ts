import type { SessionResult } from "../core/loop"
import type { AgentStores } from "../types/rooms"
import type { TranscriptRow } from "../data/sessions"
import { DECAY_TURN_WINDOW, DECAY_STUB_THRESHOLD } from "../config"

/**
 * Creates all API route handlers.
 * Receives shared state via closure to keep routes testable.
 */
export function createRoutes(state: {
  isRunning: () => boolean
  lastResult: () => SessionResult | null
  stores: AgentStores
}) {
  const { stores } = state

  return {
    "/api/status": {
      GET: async () => {
        const sessions = await stores.sessions.listSessions()
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
        const letters = stores.letters.getInbox().map((l) => ({
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
        const letter = stores.letters.addInbound(body.content.trim())
        return Response.json({
          id: letter.id,
          sentAt: letter.sentAt.toISOString(),
        })
      },
    },

    "/api/outbox": {
      GET: () => {
        const letters = stores.letters.getOutbox().map((l) => ({
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
        const letter = stores.letters.markOutboundPickedUp(req.params.id)
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
        const sessions = await stores.sessions.listSessions()
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

        const sessionInfo = await stores.sessions.getSessionInfo(sessionId)
        if (!sessionInfo) {
          return Response.json({ error: "Session not found" }, { status: 404 })
        }

        const transcript = await stores.sessions.getFullTranscript(sessionId)

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

    "/api/sessions/:id/context/:messageId": {
      GET: async (req: Request & { params: { id: string; messageId: string } }) => {
        const sessionId = parseInt(req.params.id, 10)
        const messageId = parseInt(req.params.messageId, 10)
        if (isNaN(sessionId) || isNaN(messageId)) {
          return Response.json({ error: "Invalid session ID or message ID" }, { status: 400 })
        }

        const url = new URL(req.url)
        const view = url.searchParams.get("view") ?? "context"
        if (view !== "context" && view !== "raw") {
          return Response.json({ error: "Invalid view parameter. Use 'context' or 'raw'" }, { status: 400 })
        }

        const sessionInfo = await stores.sessions.getSessionInfo(sessionId)
        if (!sessionInfo) {
          return Response.json({ error: "Session not found" }, { status: 404 })
        }

        const rows =
          view === "context"
            ? await stores.sessions.getContextUpTo(sessionId, messageId)
            : await stores.sessions.getRawTranscriptUpTo(sessionId, messageId)

        if (rows.length === 0) {
          return Response.json({ error: "Message not found in session" }, { status: 404 })
        }

        let messages: Record<string, unknown>[]

        if (view === "context") {
          messages = applyDecay(rows)
        } else {
          messages = rows.map(formatMessage)
        }

        return Response.json({
          session: {
            id: sessionInfo.sessionId,
            startedAt: sessionInfo.startedAt.toISOString(),
            endedAt: sessionInfo.endedAt?.toISOString() ?? null,
            endReason: sessionInfo.endReason,
            totalTokensUsed: sessionInfo.totalTokensUsed,
            sessionSummary: sessionInfo.sessionSummary,
          },
          upToMessageId: messageId,
          view,
          estimatedTokens: estimateTokens(messages),
          messages,
        })
      },
    },

    "/api/*": Response.json({ message: "Not found" }, { status: 404 }),
  }
}

/**
 * Rough token estimate: ~4 characters per token for English text.
 * Counts content strings and JSON-serialized tool calls.
 */
function estimateTokens(messages: Record<string, unknown>[]): number {
  let chars = 0
  for (const msg of messages) {
    if (typeof msg.content === "string") chars += msg.content.length
    if (msg.toolCalls) chars += JSON.stringify(msg.toolCalls).length
  }
  return Math.round(chars / 4)
}

function formatMessage(row: TranscriptRow): Record<string, unknown> {
  return {
    id: row.messageId,
    sequenceNum: row.sequenceNum,
    role: row.role,
    content: row.content,
    toolCalls: row.toolCalls,
    toolCallId: row.toolCallId,
    status: row.status,
    compactionId: row.compactionId,
    room: row.room,
    turnSequence: row.turnSequence,
    createdAt: row.createdAt.toISOString(),
  }
}

/**
 * Apply decay to context messages, simulating what the LLM would have seen.
 * Tool results older than DECAY_TURN_WINDOW turns with content exceeding
 * DECAY_STUB_THRESHOLD are replaced with stubs.
 */
function applyDecay(rows: TranscriptRow[]): Record<string, unknown>[] {
  // Determine the current turn from the last message's turn_sequence
  if (rows.length === 0) return []
  const lastRow = rows[rows.length - 1]
  if (!lastRow) return []
  const currentTurn = lastRow.turnSequence ?? 0
  const cutoff = currentTurn - DECAY_TURN_WINDOW

  // Build a map of tool_call_id → tool name from assistant messages
  const toolNameMap = new Map<string, string>()
  for (const row of rows) {
    if (row.role === "assistant" && row.toolCalls) {
      for (const tc of row.toolCalls) {
        toolNameMap.set(tc.id, tc.name)
      }
    }
  }

  return rows.map((row) => {
    let content = row.content

    if (
      row.role === "tool" &&
      row.toolCallId &&
      row.turnSequence != null &&
      row.turnSequence <= cutoff &&
      content &&
      content.length > DECAY_STUB_THRESHOLD
    ) {
      const toolName = toolNameMap.get(row.toolCallId) ?? "tool"
      content = `[${toolName}(): returned ${content.length} chars]`
    }

    return {
      id: row.messageId,
      sequenceNum: row.sequenceNum,
      role: row.role,
      content,
      toolCalls: row.toolCalls,
      toolCallId: row.toolCallId,
      room: row.room,
      turnSequence: row.turnSequence,
      createdAt: row.createdAt.toISOString(),
    }
  })
}
