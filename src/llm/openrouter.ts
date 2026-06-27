import { OpenRouter, fromChatMessages, toChatMessage, tool } from "@openrouter/sdk"
import { type Message as SDKMessage } from "@openrouter/sdk/models"
import type {
  LLMProvider,
  LLMMessage,
  LLMResponse,
  LLMCallOptions,
  ToolDefinition,
} from "../types/llm"
import { getPromptTokenPrice } from "./pricing"

export interface OpenRouterConfig {
  apiKey: string
  model?: string
  maxTokens?: number
  appName?: string
  siteUrl?: string
}

// Types for direct API approach

/**
 * A text content part. When `cache_control` is present, OpenRouter forwards it
 * to Anthropic as a prompt-cache breakpoint: everything up to and including this
 * block (in tools → system → messages order) is cached for ~5 minutes.
 */
interface OpenAIContentPart {
  type: "text"
  text: string
  cache_control?: { type: "ephemeral" }
}

interface OpenAIChatMessage {
  role: "system" | "user" | "assistant" | "tool"
  content: string | OpenAIContentPart[] | null
  tool_calls?: {
    id: string
    type: "function"
    function: { name: string; arguments: string }
  }[]
  tool_call_id?: string
}

interface OpenAITool {
  type: "function"
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

interface OpenAIResponse {
  id: string
  choices: {
    message: {
      role: "assistant"
      content: string | null
      tool_calls?: {
        id: string
        type: "function"
        function: { name: string; arguments: string }
      }[]
    }
    finish_reason: "stop" | "tool_calls" | "length"
  }[]
  usage: {
    prompt_tokens: number
    completion_tokens: number
    cost?: number
    /** Breakdown of prompt_tokens by cache status (OpenAI-compatible shape). */
    prompt_tokens_details?: {
      /** Tokens served from cache (a cache hit / read). */
      cached_tokens?: number
      /** Tokens written to the cache this call (a cache miss that populated it). */
      cache_write_tokens?: number
    }
    /** Cost split (returned when usage accounting is enabled). Sums to `cost`. */
    cost_details?: {
      upstream_inference_prompt_cost?: number
      upstream_inference_completions_cost?: number
    }
  }
}

export class OpenRouterProvider implements LLMProvider {
  private client: OpenRouter
  private model: string
  private maxTokens: number

  constructor(config: OpenRouterConfig) {
    this.client = new OpenRouter({
      apiKey: config.apiKey,
      ...(config.siteUrl && { httpReferer: config.siteUrl }),
      ...(config.appName && { xTitle: config.appName }),
    })
    this.model = config.model ?? "anthropic/claude-sonnet-4"
    this.maxTokens = config.maxTokens ?? 4096
  }

  async send(
    system: string,
    messages: LLMMessage[],
    tools?: ToolDefinition[]
  ): Promise<LLMResponse> {
    const chatMessages = [
      { role: "system" as const, content: system },
      ...messages.map((m) => ({
        role: m.role as "system" | "user" | "assistant" | "tool",
        content: m.content,
        ...(m.toolCalls && { tool_calls: m.toolCalls.map(tc => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: JSON.stringify(tc.args) }
        })) }),
        ...(m.toolCallId && { tool_call_id: m.toolCallId }),
      })),
    ]

    // Convert our tool definitions to SDK format
    const sdkTools = tools?.map((t) =>
      tool({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        execute: false, // Manual handling - we execute tools ourselves
      })
    )

    const result = this.client.callModel({
      model: this.model,
      input: fromChatMessages(chatMessages as SDKMessage[]),
      maxOutputTokens: this.maxTokens,
      ...(sdkTools && sdkTools.length > 0 && { tools: sdkTools }),
    })

    // Check for tool calls first
    const toolCalls = await result.getToolCalls()
    if (toolCalls && toolCalls.length > 0) {
      const response = await result.getResponse()
      return {
        content: null,
        toolCalls: toolCalls.map((tc) => ({
          id: tc.id,
          name: tc.name,
          args: tc.arguments as Record<string, unknown>,
        })),
        stopReason: "tool_calls",
        usage: {
          inputTokens: response.usage?.inputTokens ?? 0,
          outputTokens: response.usage?.outputTokens ?? 0,
        },
      }
    }

    // No tool calls, get text response
    const response = await result.getResponse()
    const chatMessage = toChatMessage(response)

    return {
      content: chatMessage.content as string | null,
      toolCalls: [],
      stopReason: "stop",
      usage: {
        inputTokens: response.usage?.inputTokens ?? 0,
        outputTokens: response.usage?.outputTokens ?? 0,
      },
    }
  }
}

/**
 * Alternative provider using direct fetch to OpenRouter's OpenAI-compatible API.
 * Avoids the SDK's fromChatMessages conversion which has issues with tool messages.
 */
export class OpenRouterProviderV2 implements LLMProvider {
  private apiKey: string
  private model: string
  private maxTokens: number
  private appName?: string
  private siteUrl?: string

  constructor(config: OpenRouterConfig) {
    this.apiKey = config.apiKey
    this.model = config.model ?? "anthropic/claude-sonnet-4"
    this.maxTokens = config.maxTokens ?? 4096
    this.appName = config.appName
    this.siteUrl = config.siteUrl
  }

  async send(
    system: string,
    messages: LLMMessage[],
    tools?: ToolDefinition[],
    opts?: LLMCallOptions
  ): Promise<LLMResponse> {
    // Build messages in OpenAI chat format.
    //
    // Prompt caching: mark the system prompt as a cache breakpoint, which caches
    // the static tools + system prefix (Anthropic's canonical order). We then add
    // a second breakpoint at the tail of the conversation so the growing message
    // history is read from cache on subsequent turns instead of re-sent in full.
    const chatMessages: OpenAIChatMessage[] = [
      {
        role: "system",
        content: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      },
      ...messages.map((m): OpenAIChatMessage => {
        if (m.role === "tool") {
          return {
            role: "tool",
            content: m.content ?? "",
            tool_call_id: m.toolCallId,
          }
        }
        if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
          return {
            role: "assistant",
            content: m.content,
            tool_calls: m.toolCalls.map((tc) => ({
              id: tc.id,
              type: "function" as const,
              function: {
                name: tc.name,
                arguments: JSON.stringify(tc.args),
              },
            })),
          }
        }
        return {
          role: m.role as "user" | "assistant",
          content: m.content,
        }
      }),
    ]

    // Second cache breakpoint: the last message carrying plain text. This caches
    // the conversation prefix so the next turn (whose prefix is identical) reads
    // it from cache. Skipped for tool-call assistant turns whose content is null.
    // Note: tool-result decay that rewrites earlier messages will invalidate this
    // prefix; the system/tools breakpoint above is unaffected.
    //
    // Placed BEFORE appending the trailing note below, so the breakpoint lands on
    // the last real (stable) message and the volatile note stays outside the cache.
    for (let i = chatMessages.length - 1; i >= 1; i--) {
      const msg = chatMessages[i]
      if (msg && typeof msg.content === "string" && msg.content.length > 0) {
        msg.content = [{ type: "text", text: msg.content, cache_control: { type: "ephemeral" } }]
        break
      }
    }

    // Ephemeral trailing note (e.g. live budget). Appended after the cache
    // breakpoint with NO cache_control: it changes every turn, so keeping it at
    // the tail means it never invalidates the cached prefix above.
    if (opts?.trailingNote) {
      chatMessages.push({ role: "user", content: opts.trailingNote })
    }

    // Convert tool definitions to OpenAI format
    const openaiTools: OpenAITool[] | undefined = tools?.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema.toJSONSchema(),
      },
    }))

    // Make direct API request to OpenRouter
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.apiKey}`,
        ...(this.siteUrl && { "HTTP-Referer": this.siteUrl }),
        ...(this.appName && { "X-Title": this.appName }),
      },
      body: JSON.stringify({
        model: this.model,
        messages: chatMessages,
        max_tokens: this.maxTokens,
        ...(openaiTools && openaiTools.length > 0 && { tools: openaiTools }),
        provider: {
          sort: "throughput",
        },
        // Opt into usage accounting so the response includes `cost` and
        // `prompt_tokens_details.cached_tokens` (the cache-hit measurement).
        usage: {
          include: true,
        },
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`OpenRouter API error: ${response.status} ${errorText}`)
    }

    const data = (await response.json()) as OpenAIResponse
    const choice = data.choices[0]

    if (!choice) {
      throw new Error("No response from OpenRouter")
    }

    const inputTokens = data.usage.prompt_tokens
    const inputCost = data.usage.cost_details?.upstream_inference_prompt_cost

    // Model-agnostic cache savings: what the prompt WOULD have cost without any
    // caching (every token at the base input rate) minus what it actually cost.
    // The actual cost already encodes this model's own read discount / write
    // premium, so no provider-specific multipliers are assumed. Positive on cache
    // reads, negative on cold writes; undefined if the base price is unknown.
    const basePrice = await getPromptTokenPrice(this.model, this.apiKey)
    const usage = {
      inputTokens,
      outputTokens: data.usage.completion_tokens,
      cost: data.usage.cost,
      cacheReadTokens: data.usage.prompt_tokens_details?.cached_tokens ?? 0,
      cacheWriteTokens: data.usage.prompt_tokens_details?.cache_write_tokens ?? 0,
      inputCost,
      outputCost: data.usage.cost_details?.upstream_inference_completions_cost,
      cacheSavings:
        basePrice != null && inputCost != null
          ? inputTokens * basePrice - inputCost
          : undefined,
    }

    // Check for tool calls
    if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
      return {
        content: choice.message.content,
        toolCalls: choice.message.tool_calls.map((tc) => ({
          id: tc.id,
          name: tc.function.name,
          // Handle empty string for tools with no arguments
          args: tc.function.arguments
            ? (JSON.parse(tc.function.arguments) as Record<string, unknown>)
            : {},
        })),
        stopReason: "tool_calls",
        usage,
      }
    }

    return {
      content: choice.message.content,
      toolCalls: [],
      stopReason: choice.finish_reason === "length" ? "length" : "stop",
      usage,
    }
  }
}