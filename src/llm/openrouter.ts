import { OpenRouter, fromChatMessages, toChatMessage, tool } from "@openrouter/sdk"
import { type Message as SDKMessage } from "@openrouter/sdk/models"
import type {
  LLMProvider,
  LLMMessage,
  LLMResponse,
  ToolDefinition,
} from "../types/llm"

export interface OpenRouterConfig {
  apiKey: string
  model?: string
  maxTokens?: number
  appName?: string
  siteUrl?: string
}

// Types for direct API approach
interface OpenAIChatMessage {
  role: "system" | "user" | "assistant" | "tool"
  content: string | null
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
    tools?: ToolDefinition[]
  ): Promise<LLMResponse> {
    // Build messages in OpenAI chat format
    const chatMessages: OpenAIChatMessage[] = [
      { role: "system", content: system },
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
        usage: {
          inputTokens: data.usage.prompt_tokens,
          outputTokens: data.usage.completion_tokens,
          cost: data.usage.cost,
        },
      }
    }

    return {
      content: choice.message.content,
      toolCalls: [],
      stopReason: choice.finish_reason === "length" ? "length" : "stop",
      usage: {
        inputTokens: data.usage.prompt_tokens,
        outputTokens: data.usage.completion_tokens,
        cost: data.usage.cost,
      },
    }
  }
}