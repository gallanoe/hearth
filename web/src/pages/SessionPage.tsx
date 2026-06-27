import { useMemo } from "react"
import { Link, useParams } from "react-router"
import { useAsync } from "@/hooks/useAsync"
import { useAgentStream } from "@/hooks/useAgentStream"
import { getSession } from "@/lib/api"
import { Loading, ErrorMessage } from "@/components/ui"
import { cn } from "@/lib/utils"

interface RenderableMessage {
  id: number
  role: string
  content: string | null
  toolCalls: unknown
  room: string | null
}

export default function SessionPage() {
  const { agentId = "", sessionId = "" } = useParams()
  const sid = Number(sessionId)
  const session = useAsync(
    () => getSession(agentId, sessionId),
    [agentId, sessionId],
  )
  const stream = useAgentStream(agentId)

  // Base transcript from the one-shot fetch (authoritative for any session),
  // overlaid with live deltas for this session, deduped by message id.
  const messages = useMemo(() => {
    const byId = new Map<number, RenderableMessage>()
    for (const m of session.data?.messages ?? []) byId.set(m.id, m)
    for (const m of stream.messages) {
      if (m.sessionId === sid) byId.set(m.id, m)
    }
    return [...byId.values()].sort((a, b) => a.id - b.id)
  }, [session.data, stream.messages, sid])

  const isLive = stream.activeSessionId === sid && stream.status === "awake"

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <Link
        to={`/agents/${agentId}`}
        className="font-mono text-xs text-muted transition-colors hover:text-text"
      >
        ← {agentId}
      </Link>

      <div className="mt-3 mb-8 flex items-baseline gap-3">
        <h1 className="font-serif text-3xl tracking-tight">
          Session {String(sid).padStart(2, "0")}
        </h1>
        {isLive && (
          <span className="font-mono text-[11px] uppercase tracking-wider text-ember">
            live
          </span>
        )}
      </div>

      {session.loading && <Loading />}
      {session.error && <ErrorMessage message={session.error} />}

      {session.data?.sessionSummary && (
        <p className="mb-8 border-l border-line pl-4 font-serif text-sm text-muted italic">
          {session.data.sessionSummary}
        </p>
      )}

      <div className="space-y-5">
        {messages.map((m) => (
          <MessageRow key={m.id} message={m} />
        ))}
      </div>
    </div>
  )
}

function MessageRow({ message }: { message: RenderableMessage }) {
  const isAgent = message.role === "assistant"
  return (
    <article className="animate-settle">
      <div className="mb-1.5 flex items-center gap-2 font-mono text-[11px] tracking-wider text-muted uppercase">
        <span>{message.role}</span>
        {message.room && <span className="text-moon">· {message.room}</span>}
      </div>
      {message.content && (
        <p
          className={cn(
            "text-[15px] leading-relaxed whitespace-pre-wrap",
            // The agent's voice is serif; everything else is the machine.
            isAgent ? "font-serif text-text" : "font-sans text-muted",
          )}
        >
          {message.content}
        </p>
      )}
      {message.toolCalls != null && (
        <pre className="mt-2 overflow-x-auto rounded-control bg-surface p-3 font-mono text-xs text-muted">
          {JSON.stringify(message.toolCalls, null, 2)}
        </pre>
      )}
    </article>
  )
}
