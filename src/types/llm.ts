import type { z } from "zod"

/** The message shape visible to LLM providers. No internal metadata. */
export interface LLMMessage {
  role: "system" | "user" | "assistant" | "tool"
  content: string | null
  toolCalls?: ToolCall[]
  toolCallId?: string
}

/** Internal message type with optional in-memory metadata for decay. */
export interface Message extends LLMMessage {
  /** In-memory only. Not persisted or sent to LLM. Used by tool result decay. */
  decay?: { turn: number; toolName: string }
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
    cost?: number
  }
}

export interface LLMProvider {
  send(
    system: string,
    messages: LLMMessage[],
    tools?: ToolDefinition[]
  ): Promise<LLMResponse>
}