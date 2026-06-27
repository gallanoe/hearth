import { startObservation, startActiveObservation, propagateAttributes } from "@langfuse/tracing"
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
        input: [{ role: "system", content: system }, ...messages],
        metadata: {
          ...opts?.metadata,
          ...(tools && tools.length > 0 ? { availableTools: tools.map((t) => t.name) } : {}),
        },
      },
      { asType: "generation" },
    )

    try {
      const res = await this.inner.send(system, messages, tools, opts)
      generation
        .update({
          output: res.content ?? { toolCalls: res.toolCalls },
          usageDetails: { input: res.usage.inputTokens, output: res.usage.outputTokens },
          ...(res.usage.cost != null ? { costDetails: { total: res.usage.cost } } : {}),
          metadata: { stopReason: res.stopReason },
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

/** Handle passed to a session body for setting the trace's final output. */
export interface SessionTraceHandle {
  setOutput(output: unknown): void
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
        })
      }),
  )
}
