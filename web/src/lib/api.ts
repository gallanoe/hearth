const BASE = "/api"

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  })
  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      const body = (await res.json()) as { error?: string }
      if (body?.error) message = body.error
    } catch {
      // response had no JSON body; keep the status-based message
    }
    throw new Error(message)
  }
  return (await res.json()) as T
}

export interface AgentSummary {
  agentId: string
  isRunning: boolean
}

export interface LastResult {
  endReason: string
  totalTokensUsed: number
  turns: number
  sessionSummary: string | null
}

export interface AgentDetail {
  agentId: string
  status: "awake" | "asleep"
  lastResult: LastResult | null
}

export interface Letter {
  id: string
  content: string
  sentAt: string
  readAt: string | null
}

export interface SessionSummary {
  id: number
  startedAt: string
  endedAt: string | null
  endReason: string | null
  totalTokensUsed: number | null
  sessionSummary: string | null
}

export interface Message {
  id: number
  sequenceNum: number
  role: string
  content: string | null
  toolCalls: unknown
  toolCallId: string | null
  status: string | null
  room: string | null
  turnSequence: number | null
  createdAt: string
}

export interface SessionDetail extends SessionSummary {
  messages: Message[]
}

/** A message as it arrives over the SSE stream (carries sessionId). */
export interface StreamMessage {
  id: number
  sessionId: number
  sequenceNum: number
  role: string
  content: string | null
  toolCalls: unknown
  toolCallId: string | null
  status: string
  room: string | null
  turnSequence: number | null
  createdAt: string
}

export const listAgents = () => request<{ agents: AgentSummary[] }>("/agents")

export const createAgent = (agentId: string) =>
  request<{ agentId: string }>("/agents", {
    method: "POST",
    body: JSON.stringify({ agentId }),
  })

export const getAgent = (id: string) => request<AgentDetail>(`/agents/${id}`)

export const wakeAgent = (id: string) =>
  request<{ success: boolean; message: string; session: number }>(
    `/agents/${id}/wake`,
    { method: "POST" },
  )

export const getInbox = (id: string) =>
  request<{ letters: Letter[] }>(`/agents/${id}/inbox`)

export const sendLetter = (id: string, content: string) =>
  request<{ id: string; sentAt: string }>(`/agents/${id}/inbox`, {
    method: "POST",
    body: JSON.stringify({ content }),
  })

export const getOutbox = (id: string) =>
  request<{ letters: Letter[] }>(`/agents/${id}/outbox`)

export const pickupLetter = (id: string, letterId: string) =>
  request<{ id: string; pickedUpAt: string }>(
    `/agents/${id}/outbox/${letterId}/pickup`,
    { method: "POST" },
  )

export const listSessions = (id: string) =>
  request<{ sessions: SessionSummary[] }>(`/agents/${id}/sessions`)

export const getSession = (id: string, sessionId: string | number) =>
  request<SessionDetail>(`/agents/${id}/sessions/${sessionId}`)
