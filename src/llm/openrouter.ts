import { OpenRouter, fromChatMessages, toChatMessage, tool } from "@openrouter/sdk"
import { type Message as SDKMessage } from "@openrouter/sdk/models"
import type {
  LLMProvider,
  LLMResponse,
  Message,
  ToolDefinition,
} from "./types"

export interface OpenRouterConfig {
  apiKey: string
  model?: string
  maxTokens?: number
  appName?: string
  siteUrl?: string
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
    messages: Message[],
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