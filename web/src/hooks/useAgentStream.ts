import { useEffect, useMemo, useState } from "react"
import type { StreamMessage } from "@/lib/api"

export interface AgentStream {
  status: "awake" | "asleep" | null
  activeSessionId: number | null
  connected: boolean
  messages: StreamMessage[]
}

/**
 * Subscribe to an agent's live event stream (SSE: GET /api/agents/:id/events).
 *
 * EventSource handles reconnection and Last-Event-ID automatically; on
 * reconnect the server replays missed messages, so we never clear messages on a
 * blip. We also don't reset state on an agentId change: a fresh connection
 * always opens with a `snapshot` that replaces status/session/messages, and
 * session ids are globally unique, so a stale cross-agent message can't be
 * mistaken for this agent's. (Keeping all setState inside event callbacks also
 * avoids the set-state-in-effect rule.)
 */
export function useAgentStream(agentId: string): AgentStream {
  const [status, setStatus] = useState<"awake" | "asleep" | null>(null)
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null)
  const [connected, setConnected] = useState(false)
  const [byId, setById] = useState<Map<number, StreamMessage>>(new Map())

  useEffect(() => {
    const es = new EventSource(`/api/agents/${agentId}/events`)

    es.addEventListener("snapshot", (event: Event) => {
      const data = JSON.parse((event as MessageEvent).data) as {
        status: "awake" | "asleep"
        session: { id: number } | null
        messages: StreamMessage[]
      }
      setStatus(data.status)
      setActiveSessionId(data.session?.id ?? null)
      setById(new Map(data.messages.map((m) => [m.id, m])))
    })

    es.addEventListener("message", (event: Event) => {
      const m = JSON.parse((event as MessageEvent).data) as StreamMessage
      setById((prev) => {
        const next = new Map(prev)
        next.set(m.id, m)
        return next
      })
    })

    es.addEventListener("status", (event: Event) => {
      const data = JSON.parse((event as MessageEvent).data) as {
        status: "awake" | "asleep"
      }
      setStatus(data.status)
    })

    es.addEventListener("open", () => setConnected(true))
    es.addEventListener("error", () => setConnected(false))

    return () => es.close()
  }, [agentId])

  const messages = useMemo(
    () => [...byId.values()].sort((a, b) => a.id - b.id),
    [byId],
  )

  return { status, activeSessionId, connected, messages }
}
