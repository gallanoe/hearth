import { test, expect, describe, beforeAll, afterAll } from "bun:test"
import { createRoutes } from "./routes"
import { agentBus } from "../events/agent-bus"
import type { AgentManager } from "../agents/manager"
import type { LLMProvider } from "../types/llm"
import type { TranscriptRow } from "../data/sessions"

const AGENT = "sse-smoke"

function row(messageId: number, sequenceNum: number, role: string, content: string): TranscriptRow {
  return {
    messageId,
    sessionId: 1,
    sequenceNum,
    role: role as TranscriptRow["role"],
    content,
    toolCalls: null,
    toolCallId: null,
    status: "active",
    compactionId: null,
    room: "office",
    turnSequence: 1,
    tokenCount: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
  }
}

const transcript = [row(10, 1, "user", "hello"), row(11, 2, "assistant", "hi")]

// Minimal fakes — the SSE route only needs getState/isRunning + the three
// session-store read methods. No DB or LLM involved.
const fakeSessions = {
  listSessions: async () => [
    {
      sessionId: 1,
      startedAt: new Date("2026-01-01T00:00:00Z"),
      endedAt: null,
      endReason: null,
      totalTokensUsed: 0,
      sessionSummary: null,
    },
  ],
  getFullTranscript: async () => transcript,
  getMessagesAfter: async (id: number) => transcript.filter((r) => r.messageId > id),
}

const fakeManager = {
  getState: (agentId: string) =>
    agentId === AGENT ? { agentId, stores: { sessions: fakeSessions } } : undefined,
  isRunning: () => false,
} as unknown as AgentManager

interface ParsedEvent {
  id?: string
  event: string
  data?: string
}

function parseBlock(block: string): ParsedEvent {
  const parsed: ParsedEvent = { event: "message" }
  for (const line of block.split("\n")) {
    if (line.startsWith("id:")) parsed.id = line.slice(3).trim()
    else if (line.startsWith("event:")) parsed.event = line.slice(6).trim()
    else if (line.startsWith("data:")) parsed.data = line.slice(5).trim()
  }
  return parsed
}

/** Reads SSE frames from a Response, one parsed event at a time. */
function makeEventReader(res: Response) {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  const queue: ParsedEvent[] = []

  async function next(timeoutMs = 2000): Promise<ParsedEvent> {
    while (queue.length === 0) {
      const timeout = new Promise<{ done: true; value: undefined }>((resolve) =>
        setTimeout(() => resolve({ done: true, value: undefined }), timeoutMs),
      )
      const result = await Promise.race([reader.read(), timeout])
      if (result.done) throw new Error("timed out / stream ended waiting for SSE event")
      buffer += decoder.decode(result.value, { stream: true })
      const parts = buffer.split("\n\n")
      buffer = parts.pop() ?? ""
      for (const part of parts) {
        if (!part.trim() || part.startsWith(":")) continue // skip heartbeat comments
        queue.push(parseBlock(part))
      }
    }
    return queue.shift()!
  }

  return { next, close: () => reader.cancel().catch(() => {}) }
}

describe("SSE /api/agents/:id/events", () => {
  let server: ReturnType<typeof Bun.serve>
  let base: string

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      routes: createRoutes({} as unknown as LLMProvider, fakeManager),
      fetch: () => new Response("not found", { status: 404 }),
    })
    base = `http://localhost:${server.port}`
  })

  afterAll(() => server.stop(true))

  test("returns 404 for an unknown agent", async () => {
    const res = await fetch(`${base}/api/agents/nope/events`)
    expect(res.status).toBe(404)
    await res.body?.cancel()
  })

  test("sends a snapshot then streams live message + status deltas", async () => {
    const ctrl = new AbortController()
    const res = await fetch(`${base}/api/agents/${AGENT}/events`, { signal: ctrl.signal })
    const stream = makeEventReader(res)

    // 1) snapshot with the existing transcript
    const snapshot = await stream.next()
    expect(snapshot.event).toBe("snapshot")
    expect(snapshot.id).toBe("11") // max message_id in the snapshot
    const snapData = JSON.parse(snapshot.data!)
    expect(snapData.status).toBe("asleep")
    expect(snapData.messages).toHaveLength(2)
    expect(snapData.messages[1].id).toBe(11)

    // 2) a live message published after we're caught up
    agentBus.publish(AGENT, {
      type: "message",
      message: {
        id: 12,
        sessionId: 1,
        sequenceNum: 3,
        role: "assistant",
        content: "live!",
        toolCalls: null,
        toolCallId: null,
        status: "active",
        room: "office",
        turnSequence: 2,
        createdAt: new Date().toISOString(),
      },
    })
    const live = await stream.next()
    expect(live.event).toBe("message")
    expect(live.id).toBe("12")
    expect(JSON.parse(live.data!).content).toBe("live!")

    // 3) a status transition
    agentBus.publish(AGENT, { type: "status", status: "awake" })
    const status = await stream.next()
    expect(status.event).toBe("status")
    expect(status.id).toBeUndefined() // status carries no id
    expect(JSON.parse(status.data!).status).toBe("awake")

    await stream.close()
    ctrl.abort()
  })

  test("reconnect with Last-Event-ID replays only missed messages (no snapshot)", async () => {
    const ctrl = new AbortController()
    const res = await fetch(`${base}/api/agents/${AGENT}/events`, {
      headers: { "Last-Event-ID": "10" },
      signal: ctrl.signal,
    })
    const stream = makeEventReader(res)

    // Should replay message 11 (id > 10), not a snapshot
    const replayed = await stream.next()
    expect(replayed.event).toBe("message")
    expect(replayed.id).toBe("11")

    // Followed by a current-status event
    const status = await stream.next()
    expect(status.event).toBe("status")

    await stream.close()
    ctrl.abort()
  })

  test("dedups messages already covered by the snapshot cursor", async () => {
    const ctrl = new AbortController()
    const res = await fetch(`${base}/api/agents/${AGENT}/events`, { signal: ctrl.signal })
    const stream = makeEventReader(res)

    const snapshot = await stream.next()
    expect(snapshot.event).toBe("snapshot") // cursor now at 11

    // An event with id <= cursor must be dropped; the id:13 event should win.
    agentBus.publish(AGENT, {
      type: "message",
      message: {
        id: 11,
        sessionId: 1,
        sequenceNum: 2,
        role: "assistant",
        content: "duplicate",
        toolCalls: null,
        toolCallId: null,
        status: "active",
        room: "office",
        turnSequence: 1,
        createdAt: new Date().toISOString(),
      },
    })
    agentBus.publish(AGENT, {
      type: "message",
      message: {
        id: 13,
        sessionId: 1,
        sequenceNum: 4,
        role: "assistant",
        content: "fresh",
        toolCalls: null,
        toolCallId: null,
        status: "active",
        room: "office",
        turnSequence: 3,
        createdAt: new Date().toISOString(),
      },
    })

    const next = await stream.next()
    expect(next.id).toBe("13")
    expect(JSON.parse(next.data!).content).toBe("fresh")

    await stream.close()
    ctrl.abort()
  })
})
