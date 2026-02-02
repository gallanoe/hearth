import type { z } from "zod"

export interface Message {
  role: "system" | "user" | "assistant" | "tool"
  content: string | null
  toolCalls?: ToolCall[]
  toolCallId?: string
}

export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
}

// Tool definition for our internal use - we'll convert to SDK format in the provider
export interface ToolDefinition {
  name: string
  description: string
  inputSchema: z.ZodObject<z.ZodRawShape>
}

export interface LLMResponse {
  content: string | null
  toolCalls: ToolCall[]
  stopReason: "stop" | "tool_calls" | "length"
  usage: {
    inputTokens: number
    outputTokens: number
  }
}

export interface LLMProvider {
  send(
    system: string,
    messages: Message[],
    tools?: ToolDefinition[]
  ): Promise<LLMResponse>
}