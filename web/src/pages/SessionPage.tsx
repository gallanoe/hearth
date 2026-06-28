import { useMemo } from "react"
import { Link, useParams } from "react-router"
import { useAsync } from "@/hooks/useAsync"
import { useAgentStream } from "@/hooks/useAgentStream"
import { useStickToBottom } from "@/hooks/useStickToBottom"
import { getSession } from "@/lib/api"
import { Loading, ErrorMessage } from "@/components/ui"
import { ToolCard, type ToolCall } from "@/components/ToolCard"
import { cn } from "@/lib/utils"

interface RenderableMessage {
  id: number
  role: string
  content: string | null
  toolCalls: unknown
  toolCallId: string | null
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

  // Auto-scroll: stick to the bottom as messages arrive, unless the reader has
  // scrolled up. The content key changes as messages are appended or the last
  // one grows; switching sessions (sid) jumps to the bottom.
  const lastMessage = messages[messages.length - 1]
  const stickRef = useStickToBottom(
    `${messages.length}:${lastMessage?.id ?? ""}:${lastMessage?.content?.length ?? 0}`,
    sid,
  )

  // Tool results are their own role:"tool" messages, linked back by toolCallId.
  // Fold each into its originating call, and remember which results we've
  // consumed so they don't also render as orphan rows.
  const { resultByCallId, consumed } = useMemo(() => {
    const resultByCallId = new Map<string, string | null>()
    for (const m of messages) {
      if (m.role === "tool" && m.toolCallId)
        resultByCallId.set(m.toolCallId, m.content)
    }
    const consumed = new Set<number>()
    for (const m of messages) {
      for (const c of toolCalls(m)) {
        if (c.id && resultByCallId.has(c.id)) {
          const r = messages.find(
            (x) => x.role === "tool" && x.toolCallId === c.id,
          )
          if (r) consumed.add(r.id)
        }
      }
    }
    return { resultByCallId, consumed }
  }, [messages])

  return (
    <div>
      <header className="sticky top-0 z-10 border-b border-line bg-base/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-6 py-3.5">
          <Link
            to={`/agents/${agentId}`}
            className="font-mono text-xs text-muted transition-colors hover:text-text"
          >
            ← {agentId}
          </Link>
          <span className="text-line">/</span>
          <h1 className="font-serif text-base tracking-tight">
            Session {String(sid).padStart(2, "0")}
          </h1>
          {isLive && (
            <span className="ml-auto flex items-center gap-1.5 font-mono text-[11px] tracking-wider text-ember uppercase">
              <span className="h-1.5 w-1.5 animate-breathe rounded-full bg-ember glow-ember" />
              live
            </span>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-6 py-10">
        {session.loading && <Loading />}
        {session.error && <ErrorMessage message={session.error} />}

        {session.data?.sessionSummary && (
          <p className="mb-8 border-l border-line pl-4 font-serif text-sm text-muted italic">
            {session.data.sessionSummary}
          </p>
        )}

        {!session.loading && !session.error && messages.length === 0 && (
          <p className="text-sm text-muted">
            Nothing recorded yet. {isLive ? "The agent is just waking." : ""}
          </p>
        )}

        <div className="space-y-6">
          {messages.map((m) =>
            m.role === "tool" && consumed.has(m.id) ? null : (
              <MessageRow
                key={m.id}
                message={m}
                agentId={agentId}
                resultByCallId={resultByCallId}
                live={isLive}
              />
            ),
          )}
          {/* Anchor for stick-to-bottom; locates the scroll container. */}
          <div ref={stickRef} />
        </div>
      </div>
    </div>
  )
}

function MessageRow({
  message,
  agentId,
  resultByCallId,
  live,
}: {
  message: RenderableMessage
  agentId: string
  resultByCallId: Map<string, string | null>
  live: boolean
}) {
  const isAgent = message.role === "assistant"
  const calls = toolCalls(message)
  // The inhabitant speaks under its own name; everything else keeps its role.
  const who = isAgent ? agentId : message.role

  // An orphan tool result (no matching call in view) still renders as a card.
  if (message.role === "tool") {
    return (
      <article className="animate-settle">
        <ToolCard
          call={{ id: message.toolCallId ?? "", name: "tool result" }}
          result={message.content}
        />
      </article>
    )
  }

  return (
    <article className="animate-settle">
      <div className="mb-1.5 flex items-center gap-2 font-mono text-[11px] tracking-wider text-muted uppercase">
        <span className={cn(isAgent && "text-text/70")}>{who}</span>
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

      {calls.length > 0 && (
        <div className={cn("space-y-2", message.content && "mt-3")}>
          {calls.map((c, i) => {
            const hasResult = c.id ? resultByCallId.has(c.id) : false
            return (
              <ToolCard
                key={c.id || i}
                call={c}
                result={c.id ? resultByCallId.get(c.id) : undefined}
                pending={live && !hasResult}
              />
            )
          })}
        </div>
      )}
    </article>
  )
}

/** Narrow the loosely-typed `toolCalls` field to a usable array of calls. */
function toolCalls(m: RenderableMessage): ToolCall[] {
  return Array.isArray(m.toolCalls) ? (m.toolCalls as ToolCall[]) : []
}
