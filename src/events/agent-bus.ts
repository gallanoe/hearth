/**
 * In-memory pub/sub for live agent events, consumed by the SSE endpoint.
 *
 * Single-process only: listeners live in this process's memory. If Hearth is
 * ever scaled to multiple server instances behind a load balancer, this would
 * need a shared transport (Postgres LISTEN/NOTIFY or Redis pub/sub) so events
 * fan out across processes.
 */

/** A transcript message serialized for the wire (mirrors the REST message shape). */
export interface SerializedMessage {
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

/**
 * Events published per agent.
 * - `message` carries a monotonic `message.id` used as the SSE event id.
 * - `status` is ephemeral (not persisted, no id) — re-sent on every connect.
 */
export type AgentEvent =
  | { type: "message"; message: SerializedMessage }
  | {
      type: "status"
      status: "awake" | "asleep"
      endReason?: string | null
    }

type Listener = (event: AgentEvent) => void

class AgentEventBus {
  private listeners = new Map<string, Set<Listener>>()

  /** Subscribe to an agent's events. Returns an unsubscribe function. */
  subscribe(agentId: string, listener: Listener): () => void {
    let set = this.listeners.get(agentId)
    if (!set) {
      set = new Set()
      this.listeners.set(agentId, set)
    }
    set.add(listener)

    return () => {
      const current = this.listeners.get(agentId)
      if (!current) return
      current.delete(listener)
      if (current.size === 0) this.listeners.delete(agentId)
    }
  }

  /** Publish an event to all subscribers of an agent. No-op if none. */
  publish(agentId: string, event: AgentEvent): void {
    const set = this.listeners.get(agentId)
    if (!set) return
    for (const listener of set) {
      try {
        listener(event)
      } catch (error) {
        console.error("AgentEventBus listener failed:", error)
      }
    }
  }

  /** Number of active subscribers for an agent (useful for diagnostics). */
  subscriberCount(agentId: string): number {
    return this.listeners.get(agentId)?.size ?? 0
  }
}

export const agentBus = new AgentEventBus()
