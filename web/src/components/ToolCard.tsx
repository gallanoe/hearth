import type { ReactNode } from "react"

/** An assistant tool call as it arrives in a message's `toolCalls` array. */
export interface ToolCall {
  id: string
  name: string
  args?: Record<string, unknown>
}

/**
 * One mechanical action the mind took, and what came back — folded into a
 * single collapsed-by-default card. Tool work is the *instrument* (mono, quiet
 * hairlines), kept distinct from the agent's *voice* (serif). While a result
 * hasn't streamed in yet the card breathes an ember dot, so a live transcript
 * shows the house working in real time.
 */
export function ToolCard({
  call,
  result,
  pending,
}: {
  call: ToolCall
  result?: string | null
  pending?: boolean
}) {
  const hint = summarize(call.name, call.args)
  const args = call.args ?? {}
  const hasArgs = Object.keys(args).length > 0
  const hasResult = result != null && result !== ""

  return (
    <details className="group rounded-panel border border-line bg-surface/50 open:bg-surface">
      <summary className="flex cursor-pointer list-none items-center gap-2.5 rounded-panel px-3 py-2 transition-colors hover:bg-surface-2/50 [&::-webkit-details-marker]:hidden">
        <svg
          viewBox="0 0 8 12"
          aria-hidden
          className="h-2.5 w-2 shrink-0 fill-none stroke-muted stroke-[1.5] transition-transform group-open:rotate-90"
        >
          <path
            d="M1.5 1.5 6 6l-4.5 4.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="shrink-0 font-mono text-xs text-text">
          {call.name}
        </span>
        {hint && (
          <span className="truncate font-mono text-xs text-muted">{hint}</span>
        )}
        <span className="ml-auto shrink-0">
          {pending && !hasResult ? (
            <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-ember">
              <span className="h-1.5 w-1.5 animate-breathe rounded-full bg-ember glow-ember" />
              running
            </span>
          ) : (
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted/50 group-open:hidden">
              done
            </span>
          )}
        </span>
      </summary>

      <div className="space-y-3 border-t border-line px-3 py-3">
        {hasArgs && (
          <Field label="arguments">
            <pre className="max-h-60 overflow-auto rounded-control bg-base/60 p-2.5 font-mono text-xs leading-relaxed text-muted">
              {JSON.stringify(args, null, 2)}
            </pre>
          </Field>
        )}
        <Field label="result">
          {hasResult ? (
            <pre className="max-h-72 overflow-auto rounded-control bg-base/60 p-2.5 font-mono text-xs leading-relaxed whitespace-pre-wrap text-muted">
              {result}
            </pre>
          ) : pending ? (
            <p className="font-mono text-xs text-ember">
              waiting on the result…
            </p>
          ) : (
            <p className="font-mono text-xs text-muted/60">
              no result recorded
            </p>
          )}
        </Field>
      </div>
    </details>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-muted/70">
        {label}
      </div>
      {children}
    </div>
  )
}

/**
 * Pull the single most telling argument out of a call so a collapsed card reads
 * like a sentence — `bash  ls -la`, `move_to  → office`, `read  src/app.ts` —
 * instead of a bare tool name. Falls back to the first string argument.
 */
function summarize(name: string, args?: Record<string, unknown>): string {
  const str = (k: string) =>
    typeof args?.[k] === "string" ? (args![k] as string) : undefined
  const clean = (s?: string) => (s ? truncate(collapse(s)) : "")

  switch (name) {
    case "move_to": {
      const dest = clean(str("room") ?? str("destination"))
      return dest ? `→ ${dest}` : ""
    }
    case "bash":
      return clean(str("command") ?? str("cmd"))
    case "read":
    case "write":
    case "edit":
      return clean(str("path") ?? str("file"))
    case "find":
      return clean(str("query") ?? str("pattern") ?? str("path"))
    case "fetch":
      return clean(str("url"))
    case "web_search":
      return clean(str("query"))
    case "read_book":
      return clean(str("title") ?? str("book"))
    case "send_message":
      return clean(str("to") ?? str("recipient"))
    case "remember":
    case "recall":
    case "forget":
      return clean(str("content") ?? str("query"))
    default: {
      const first = Object.values(args ?? {}).find((v) => typeof v === "string")
      return clean(first as string | undefined)
    }
  }
}

const collapse = (s: string) => s.replace(/\s+/g, " ").trim()
const truncate = (s: string) => (s.length > 80 ? s.slice(0, 79) + "…" : s)
