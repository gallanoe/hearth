import { useState, type FormEvent, type ReactNode } from "react"
import { Link, useParams } from "react-router"
import { useAsync } from "@/hooks/useAsync"
import { useAgentStream } from "@/hooks/useAgentStream"
import {
  getAgent,
  wakeAgent,
  getInbox,
  sendLetter,
  getOutbox,
  pickupLetter,
  listSessions,
} from "@/lib/api"
import { Loading, ErrorMessage, StatusDot } from "@/components/ui"
import { cn } from "@/lib/utils"

export default function AgentDetailPage() {
  const { agentId = "" } = useParams()
  const agent = useAsync(() => getAgent(agentId), [agentId])
  const sessions = useAsync(() => listSessions(agentId), [agentId])
  const stream = useAgentStream(agentId)
  const [waking, setWaking] = useState(false)
  const [wakeError, setWakeError] = useState<string | null>(null)

  // Prefer the live stream status; fall back to the initial fetch.
  const status = stream.status ?? agent.data?.status ?? null
  const isAwake = status === "awake"

  async function handleWake() {
    setWaking(true)
    setWakeError(null)
    try {
      await wakeAgent(agentId)
      agent.refetch()
      sessions.refetch()
    } catch (err) {
      setWakeError(err instanceof Error ? err.message : String(err))
    } finally {
      setWaking(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <header
        className={cn(
          "mb-10 rounded-panel border border-line",
          isAwake && "hearth-glow",
        )}
      >
        <div className="flex items-start justify-between gap-4 p-6">
          <div className="flex items-center gap-3">
            <StatusDot awake={isAwake} />
            <div>
              <h1 className="font-serif text-3xl leading-none tracking-tight">
                {agentId}
              </h1>
              <p className="mt-2 font-mono text-xs uppercase tracking-wider text-muted">
                {status ?? "—"}
              </p>
            </div>
          </div>
          <button
            onClick={handleWake}
            disabled={waking || isAwake || agent.loading}
            className="rounded-control border border-ember/40 bg-ember/10 px-4 py-2 text-sm font-medium text-ember transition-colors hover:bg-ember/20 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-ember/10"
          >
            {isAwake ? "Awake" : waking ? "Waking…" : "Wake"}
          </button>
        </div>
      </header>

      {agent.error && <ErrorMessage message={agent.error} />}
      {wakeError && (
        <div className="mb-6">
          <ErrorMessage message={wakeError} />
        </div>
      )}

      {agent.data?.lastResult && (
        <Section title="Last session">
          <dl className="grid grid-cols-2 gap-5 sm:grid-cols-3">
            <Stat label="End reason" value={agent.data.lastResult.endReason} />
            <Stat label="Turns" value={String(agent.data.lastResult.turns)} />
            <Stat
              label="Tokens"
              value={agent.data.lastResult.totalTokensUsed.toLocaleString()}
            />
          </dl>
          {agent.data.lastResult.sessionSummary && (
            <p className="mt-5 border-l border-line pl-4 font-serif text-sm text-muted italic">
              {agent.data.lastResult.sessionSummary}
            </p>
          )}
        </Section>
      )}

      <div className="grid gap-8 sm:grid-cols-2">
        <Inbox agentId={agentId} />
        <Outbox agentId={agentId} />
      </div>

      <Section title="Sessions">
        {sessions.loading && <Loading />}
        {sessions.error && <ErrorMessage message={sessions.error} />}
        {sessions.data?.sessions.length === 0 && (
          <p className="text-sm text-muted">No sessions yet.</p>
        )}
        <ul className="divide-y divide-line">
          {sessions.data?.sessions.map((s) => (
            <li key={s.id}>
              <Link
                to={`/agents/${agentId}/sessions/${s.id}`}
                className="flex items-center justify-between py-3 text-sm text-muted transition-colors hover:text-text"
              >
                <span className="font-mono">
                  {String(s.id).padStart(2, "0")}
                </span>
                <span className="font-mono text-xs">
                  {s.endReason ?? "running"}
                  {s.totalTokensUsed != null &&
                    ` · ${s.totalTokensUsed.toLocaleString()} tok`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  )
}

function Inbox({ agentId }: { agentId: string }) {
  const inbox = useAsync(() => getInbox(agentId), [agentId])
  const [content, setContent] = useState("")
  const [sending, setSending] = useState(false)

  async function handleSend(e: FormEvent) {
    e.preventDefault()
    const text = content.trim()
    if (!text) return
    setSending(true)
    try {
      await sendLetter(agentId, text)
      setContent("")
      inbox.refetch()
    } finally {
      setSending(false)
    }
  }

  return (
    <Section title="Inbox">
      <form onSubmit={handleSend} className="mb-4 flex flex-col gap-2">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Write a letter to the agent…"
          rows={2}
          className="w-full resize-none rounded-control border border-line bg-base px-3 py-2 text-sm text-text outline-none placeholder:text-muted/60 focus:border-muted"
        />
        <button
          type="submit"
          disabled={sending || !content.trim()}
          className="self-end rounded-control border border-line px-3 py-1.5 text-xs font-medium text-text transition-colors hover:border-muted hover:bg-surface-2 disabled:opacity-40"
        >
          {sending ? "Sending…" : "Send"}
        </button>
      </form>
      {inbox.loading && <Loading />}
      {inbox.error && <ErrorMessage message={inbox.error} />}
      {inbox.data?.letters.length === 0 && (
        <p className="text-sm text-muted">
          No letters yet. Write the first one.
        </p>
      )}
      <ul className="space-y-3">
        {inbox.data?.letters.map((l) => (
          <li key={l.id} className="border-l border-line pl-3">
            <p className="whitespace-pre-wrap text-sm text-text">{l.content}</p>
            <p className="mt-1 font-mono text-[11px] text-muted">
              {new Date(l.sentAt).toLocaleString()}
            </p>
          </li>
        ))}
      </ul>
    </Section>
  )
}

function Outbox({ agentId }: { agentId: string }) {
  const outbox = useAsync(() => getOutbox(agentId), [agentId])

  async function handlePickup(letterId: string) {
    await pickupLetter(agentId, letterId)
    outbox.refetch()
  }

  return (
    <Section title="Outbox">
      {outbox.loading && <Loading />}
      {outbox.error && <ErrorMessage message={outbox.error} />}
      {outbox.data?.letters.length === 0 && (
        <p className="text-sm text-muted">No letters from the agent.</p>
      )}
      <ul className="space-y-3">
        {outbox.data?.letters.map((l) => (
          // The agent's own voice — serif, warmed by an ember edge.
          <li key={l.id} className="border-l border-ember/30 pl-3">
            <p className="whitespace-pre-wrap font-serif text-[15px] leading-relaxed text-text italic">
              {l.content}
            </p>
            <div className="mt-1.5 flex items-center justify-between font-mono text-[11px] text-muted">
              <span>{new Date(l.sentAt).toLocaleString()}</span>
              {l.readAt ? (
                <span>picked up</span>
              ) : (
                <button
                  onClick={() => handlePickup(l.id)}
                  className="text-muted transition-colors hover:text-text"
                >
                  mark picked up
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Section>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="mb-4 font-mono text-[11px] uppercase tracking-wider text-muted">
        {title}
      </h2>
      {children}
    </section>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-mono text-[11px] uppercase tracking-wider text-muted">
        {label}
      </dt>
      <dd className="mt-1 font-mono text-sm text-text">{value}</dd>
    </div>
  )
}
