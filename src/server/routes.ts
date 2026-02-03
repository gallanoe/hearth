import type { LLMProvider } from "../types/llm"
import type { AgentManager } from "../agents/manager"
import type { TranscriptRow } from "../data/sessions"
import { runSession, type SessionConfig } from "../core/loop"
import { DEFAULT_BUDGET, DECAY_TURN_WINDOW, DECAY_STUB_THRESHOLD } from "../config"

/**
 * Creates all API route handlers for the multi-agent API.
 */
export function createRoutes(llm: LLMProvider, manager: AgentManager) {
  /** Helper: look up agent state, return 404 Response if not found. */
  function getAgentOrFail(agentId: string) {
    const state = manager.getState(agentId)
    if (!state) return null
    return state
  }

  return {
    "/api/agents": {
      POST: async (req: Request) => {
        const body = (await req.json()) as { agentId?: string }
        const agentId = body.agentId?.trim()
        if (!agentId) {
          return Response.json({ error: "agentId is required" }, { status: 400 })
        }

        try {
          await manager.createAgent(agentId)
          return Response.json({ agentId }, { status: 201 })
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to create agent"
          return Response.json({ error: message }, { status: 400 })
        }
      },

      GET: () => {
        return Response.json({ agents: manager.listAgents() })
      },
    },

    "/api/agents/:id": {
      GET: (req: Request & { params: { id: string } }) => {
        const state = getAgentOrFail(req.params.id)
        if (!state) return Response.json({ error: "Agent not found" }, { status: 404 })

        const agentId = req.params.id
        const lastResult = manager.getLastResult(agentId)

        return Response.json({
          agentId,
          status: manager.isRunning(agentId) ? "awake" : "asleep",
          lastResult: lastResult
            ? {
                endReason: lastResult.endReason,
                totalTokensUsed: lastResult.totalTokensUsed,
                turns: lastResult.turns.length,
                sessionSummary: lastResult.sessionSummary,
              }
            : null,
        })
      },
    },

    "/api/agents/:id/wake": {
      POST: async (req: Request & { params: { id: string } }) => {
        const agentId = req.params.id
        const state = getAgentOrFail(agentId)
        if (!state) return Response.json({ error: "Agent not found" }, { status: 404 })

        if (manager.isRunning(agentId)) {
          return Response.json({ error: "Agent is already awake" }, { status: 400 })
        }

        const { stores } = state
        const nextSessionNumber = await stores.sessions.getNextSessionNumber()

        if (nextSessionNumber === 1) {
          stores.letters.sendWelcomeLetterIfFirstSession()
        }

        manager.setRunning(agentId, true)

        const previousSessionSummary = await stores.sessions.getPreviousSessionSummary()
        const lastResult = manager.getLastResult(agentId)

        const sessionConfig: SessionConfig = {
          sessionNumber: nextSessionNumber,
          budget: DEFAULT_BUDGET,
          reflections: [],
          inboxCount: stores.letters.getUnreadCount(),
          previousSessionSummary: previousSessionSummary ?? lastResult?.sessionSummary ?? null,
        }

        // Fire and forget - run session asynchronously
        runSession(llm, sessionConfig, state)
          .then((result) => {
            manager.setLastResult(agentId, result)
            manager.setRunning(agentId, false)
            console.log(`\n✅ Session ${nextSessionNumber} completed for ${agentId}: ${result.endReason}`)
          })
          .catch((error) => {
            manager.setRunning(agentId, false)
            console.error(`Error running session for ${agentId}:`, error)
          })

        return Response.json({
          success: true,
          message: `Agent ${agentId} is waking up`,
          session: nextSessionNumber,
        })
      },
    },

    "/api/agents/:id/sleep": {
      POST: (req: Request & { params: { id: string } }) => {
        const state = getAgentOrFail(req.params.id)
        if (!state) return Response.json({ error: "Agent not found" }, { status: 404 })

        return Response.json(
          { error: "External sleep not implemented. Agents sleep via the go_to_sleep tool." },
          { status: 501 },
        )
      },
    },

    "/api/agents/:id/inbox": {
      GET: (req: Request & { params: { id: string } }) => {
        const state = getAgentOrFail(req.params.id)
        if (!state) return Response.json({ error: "Agent not found" }, { status: 404 })

        const letters = state.stores.letters.getInbox().map((l) => ({
          id: l.id,
          content: l.content,
          sentAt: l.sentAt.toISOString(),
          readAt: l.readAt?.toISOString() ?? null,
        }))
        return Response.json({ letters })
      },

      POST: async (req: Request & { params: { id: string } }) => {
        const state = getAgentOrFail(req.params.id)
        if (!state) return Response.json({ error: "Agent not found" }, { status: 404 })

        const body = (await req.json()) as { content: string }
        if (!body.content || body.content.trim().length === 0) {
          return Response.json({ error: "Content is required" }, { status: 400 })
        }
        const letter = state.stores.letters.addInbound(body.content.trim())
        return Response.json({
          id: letter.id,
          sentAt: letter.sentAt.toISOString(),
        })
      },
    },

    "/api/agents/:id/outbox": {
      GET: (req: Request & { params: { id: string } }) => {
        const state = getAgentOrFail(req.params.id)
        if (!state) return Response.json({ error: "Agent not found" }, { status: 404 })

        const letters = state.stores.letters.getOutbox().map((l) => ({
          id: l.id,
          content: l.content,
          sentAt: l.sentAt.toISOString(),
          readAt: l.readAt?.toISOString() ?? null,
        }))
        return Response.json({ letters })
      },
    },

    "/api/agents/:id/outbox/:letterId/pickup": {
      POST: (req: Request & { params: { id: string; letterId: string } }) => {
        const state = getAgentOrFail(req.params.id)
        if (!state) return Response.json({ error: "Agent not found" }, { status: 404 })

        const letter = state.stores.letters.markOutboundPickedUp(req.params.letterId)
        if (!letter) {
          return Response.json({ error: "Letter not found" }, { status: 404 })
        }
        return Response.json({
          id: letter.id,
          pickedUpAt: new Date().toISOString(),
        })
      },
    },

    "/api/agents/:id/sessions": {
      GET: async (req: Request & { params: { id: string } }) => {
        const state = getAgentOrFail(req.params.id)
        if (!state) return Response.json({ error: "Agent not found" }, { status: 404 })

        const sessions = await state.stores.sessions.listSessions()
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

    "/api/agents/:id/sessions/:sid": {
      GET: async (req: Request & { params: { id: string; sid: string } }) => {
        const state = getAgentOrFail(req.params.id)
        if (!state) return Response.json({ error: "Agent not found" }, { status: 404 })

        const sessionId = parseInt(req.params.sid, 10)
        if (isNaN(sessionId)) {
          return Response.json({ error: "Invalid session ID" }, { status: 400 })
        }

        const sessionInfo = await state.stores.sessions.getSessionInfo(sessionId)
        if (!sessionInfo) {
          return Response.json({ error: "Session not found" }, { status: 404 })
        }

        const transcript = await state.stores.sessions.getFullTranscript(sessionId)

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

    "/api/agents/:id/sessions/:sid/context/:messageId": {
      GET: async (req: Request & { params: { id: string; sid: string; messageId: string } }) => {
        const state = getAgentOrFail(req.params.id)
        if (!state) return Response.json({ error: "Agent not found" }, { status: 404 })

        const sessionId = parseInt(req.params.sid, 10)
        const messageId = parseInt(req.params.messageId, 10)
        if (isNaN(sessionId) || isNaN(messageId)) {
          return Response.json({ error: "Invalid session ID or message ID" }, { status: 400 })
        }

        const url = new URL(req.url)
        const view = url.searchParams.get("view") ?? "context"
        if (view !== "context" && view !== "raw") {
          return Response.json({ error: "Invalid view parameter. Use 'context' or 'raw'" }, { status: 400 })
        }

        const sessionInfo = await state.stores.sessions.getSessionInfo(sessionId)
        if (!sessionInfo) {
          return Response.json({ error: "Session not found" }, { status: 404 })
        }

        const rows =
          view === "context"
            ? await state.stores.sessions.getContextUpTo(sessionId, messageId)
            : await state.stores.sessions.getRawTranscriptUpTo(sessionId, messageId)

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
  if (rows.length === 0) return []
  const lastRow = rows[rows.length - 1]
  if (!lastRow) return []
  const currentTurn = lastRow.turnSequence ?? 0
  const cutoff = currentTurn - DECAY_TURN_WINDOW

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
