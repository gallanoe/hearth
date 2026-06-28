import { startObservation, startActiveObservation, propagateAttributes } from "@langfuse/tracing"
import { getLangfuseClient } from "./instrumentation"
import type {
  LLMProvider,
  LLMMessage,
  LLMResponse,
  ToolDefinition,
  LLMCallOptions,
} from "../types/llm"

/**
 * Decorates an LLMProvider, emitting one Langfuse generation per send().
 *
 * Generations auto-nest under the active session span established by
 * {@link withSessionTrace}, so each agent "day" becomes a single trace whose
 * children are the per-turn calls, compactions, and the end-of-session summary.
 */
export class TracedProvider implements LLMProvider {
  constructor(
    private readonly inner: LLMProvider,
    private readonly model: string,
  ) {}

  async send(
    system: string,
    messages: LLMMessage[],
    tools?: ToolDefinition[],
    opts?: LLMCallOptions,
  ): Promise<LLMResponse> {
    const generation = startObservation(
      opts?.name ?? "llm-call",
      {
        model: this.model,
        // Mirror exactly what the inner provider sends: the ephemeral trailing
        // note (e.g. the in-world time of day) is appended as a final user
        // message AFTER the cache breakpoint, so include it here too — otherwise
        // the trace input omits content the model actually received.
        input: [
          { role: "system", content: system },
          ...messages,
          ...(opts?.trailingNote ? [{ role: "user", content: opts.trailingNote }] : []),
        ],
        metadata: {
          ...opts?.metadata,
          ...(tools && tools.length > 0 ? { availableTools: tools.map((t) => t.name) } : {}),
        },
      },
      { asType: "generation" },
    )

    try {
      const res = await this.inner.send(system, messages, tools, opts)
      // inputTokens is the TOTAL prompt size (both cache reads and writes are
      // counted in it), so subtract both to keep input + cache_read + cache_creation
      // == total. Reported with Anthropic's native usage keys so Langfuse shows a
      // per-generation cache hit rate and breaks out cache-write cost.
      const cacheRead = res.usage.cacheReadTokens ?? 0
      const cacheWrite = res.usage.cacheWriteTokens ?? 0
      generation
        .update({
          output: res.content ?? { toolCalls: res.toolCalls },
          usageDetails: {
            input: res.usage.inputTokens - cacheRead - cacheWrite,
            output: res.usage.outputTokens,
            ...(cacheRead > 0 ? { cache_read_input_tokens: cacheRead } : {}),
            ...(cacheWrite > 0 ? { cache_creation_input_tokens: cacheWrite } : {}),
          },
          ...(res.usage.cost != null
            ? {
                costDetails: {
                  ...(res.usage.inputCost != null ? { input: res.usage.inputCost } : {}),
                  ...(res.usage.outputCost != null ? { output: res.usage.outputCost } : {}),
                  total: res.usage.cost,
                },
              }
            : {}),
          metadata: {
            stopReason: res.stopReason,
            ...(res.usage.cacheSavings != null ? { cacheSavingsUsd: res.usage.cacheSavings } : {}),
          },
        })
        .end()
      return res
    } catch (err) {
      generation
        .update({
          level: "ERROR",
          statusMessage: err instanceof Error ? err.message : String(err),
        })
        .end()
      throw err
    }
  }
}

/** Handle for the per-turn span. */
export interface TurnSpanHandle {
  setInput(input: unknown): void
  setOutput(output: unknown): void
  setMetadata(metadata: Record<string, unknown>): void
}

/**
 * Wrap one agent turn in a span. Because the span is made active for the duration
 * of `fn`, the llm.send generation and the tool-execution spans created while it
 * runs auto-nest beneath it — so a turn reads as `completion → tool, tool, …`
 * rather than a single opaque "turn" leaf. No-op span when tracing is disabled.
 */
export async function withTurnSpan<T>(
  meta: { turn: number; room: string },
  fn: (span: TurnSpanHandle) => Promise<T>,
): Promise<T> {
  return startActiveObservation("turn", async (span) => {
    span.update({ metadata: { turn: meta.turn, room: meta.room } })
    return fn({
      setInput: (input) => span.update({ input }),
      setOutput: (output) => span.update({ output }),
      setMetadata: (metadata) => span.update({ metadata }),
    })
  })
}

/** Handle for a single tool-execution span. */
export interface ToolSpanHandle {
  setOutput(output: unknown): void
  /** Mark the span failed with a message (the tool returned success: false). */
  setError(message: string): void
}

/**
 * Wrap a single tool execution in a `tool`-type observation, nested under the
 * active turn span. `input`/`output` must be redaction-adjusted by the caller so
 * tools that opt out of persistence don't leak into traces either.
 *
 * Every tool span is named just `tool` (not `tool: <name>`) so the trace tree
 * stays uniform; the specific tool name is recorded in metadata (`tool`) rather
 * than in the span name, so it remains filterable without cluttering the label.
 */
export async function withToolSpan<T>(
  meta: { name: string; input?: unknown; metadata?: Record<string, unknown> },
  fn: (span: ToolSpanHandle) => Promise<T>,
): Promise<T> {
  return startActiveObservation(
    "tool",
    async (span) => {
      span.update({ input: meta.input, metadata: { tool: meta.name, ...meta.metadata } })
      return fn({
        setOutput: (output) => span.update({ output }),
        setError: (message) => span.update({ level: "ERROR", statusMessage: message }),
      })
    },
    { asType: "tool" },
  )
}

/** Handle passed to a session body for setting the trace's final output/metadata. */
export interface SessionTraceHandle {
  setOutput(output: unknown): void
  /** Attach session-level metadata to the trace span (e.g. cache savings). */
  setMetadata(metadata: Record<string, unknown>): void
  /**
   * Emit a numeric Langfuse Score on the session trace, so it can be charted and
   * trended across sessions. No-op when tracing is disabled.
   */
  score(name: string, value: number, opts?: { comment?: string; metadata?: Record<string, unknown> }): void
}

/**
 * Runs `fn` inside a Langfuse trace representing one agent session (one "day").
 *
 * All llm.send() generations created within `fn` auto-nest under this session
 * span, and the trace is tagged with the agent (userId) and session (sessionId)
 * so it groups in Langfuse's Sessions view. When tracing is disabled the spans
 * are non-recording no-ops and `fn` simply runs as normal.
 */
export async function withSessionTrace<T>(
  meta: { agentId: string; sessionNumber: number },
  fn: (trace: SessionTraceHandle) => Promise<T>,
): Promise<T> {
  return propagateAttributes(
    {
      userId: meta.agentId,
      sessionId: `${meta.agentId}-session-${meta.sessionNumber}`,
      traceName: `${meta.agentId} · session ${meta.sessionNumber}`,
      tags: ["hearth", "session"],
    },
    () =>
      startActiveObservation(`session-${meta.sessionNumber}`, async (span) => {
        return fn({
          setOutput: (output) => {
            span.update({ output })
          },
          setMetadata: (metadata) => {
            span.update({ metadata })
          },
          score: (name, value, opts) => {
            // activeTrace attaches the score to the currently-active span's trace,
            // which is this session span (the loop runs inside this callback).
            getLangfuseClient()?.score.activeTrace({
              name,
              value,
              ...(opts?.comment != null ? { comment: opts.comment } : {}),
              ...(opts?.metadata != null ? { metadata: opts.metadata } : {}),
            })
          },
        })
      }),
  )
}
