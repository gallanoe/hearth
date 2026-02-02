import type { z } from "zod"
import type { Workspace } from "../workspace/types"
import type { LetterStore } from "../data/letters"
import type { PersonaStore } from "../data/persona"
import type { RoomDecorationStore } from "../data/decorations"
import type { ReflectionStore } from "../data/reflections"
import type { BookStore } from "../data/books"
import type { SessionStore } from "../data/sessions"
import type { MemoryStore } from "../data/memories"
import type { PlanStore } from "../data/plans"

/**
 * All stores an agent needs, keyed for easy access.
 */
export interface AgentStores {
  letters: LetterStore
  persona: PersonaStore
  decorations: RoomDecorationStore
  reflections: ReflectionStore
  books: BookStore
  sessions: SessionStore
  memories: MemoryStore
  plans: PlanStore
}

/**
 * Context passed to tool execution and room hooks.
 * This is the agent's "awareness" of its current state.
 */
export interface AgentContext {
  agentId: string
  workspace: Workspace
  stores: AgentStores
  currentRoom: string
  currentSession: number
  budget: {
    total: number
    spent: number
    remaining: number
    warningThreshold: number
  }
  // Allows tools to signal state changes
  signals: {
    requestedSleep: boolean
    requestedMove: string | null
  }
}

/**
 * Result of executing a tool.
 */
export interface ToolResult {
  success: boolean
  output: string
  // Optional state mutation for rooms with persistent state
  stateUpdate?: Record<string, unknown>
}

/**
 * An executable tool - pairs the LLM-facing definition with actual implementation.
 */
export interface ExecutableTool {
  name: string
  description: string
  inputSchema: z.ZodObject<z.ZodRawShape>
  execute: (params: Record<string, unknown>, context: AgentContext) => Promise<ToolResult>
  /** Whether to persist the tool call arguments to the database. Defaults to true. */
  persistInput?: boolean
  /** Whether to persist the tool result content to the database. Defaults to true. */
  persistResult?: boolean
}

/**
 * Room definition.
 */
export interface Room {
  id: string
  name: string
  description: string | (() => string) // Can be static or dynamic
  tools: ExecutableTool[]
  transitions: string[] | "*"
  // Optional persistent state schema (e.g., garden plants)
  stateSchema?: z.ZodObject<z.ZodRawShape>
  // Hooks
  onEnter?: (context: AgentContext, state?: Record<string, unknown>) => Promise<string | void>
  onExit?: (context: AgentContext, state?: Record<string, unknown>) => Promise<void>
}

/**
 * Resolves a room description, calling it if it's a function.
 */
export function resolveDescription(description: string | (() => string)): string {
  return typeof description === "function" ? description() : description
}

/**
 * Universal tools available in all rooms.
 */
export interface UniversalTools {
  moveTo: ExecutableTool
  readInbox: ExecutableTool
  sendMessage: ExecutableTool
  decorateRoom: ExecutableTool
  remember: ExecutableTool
  recall: ExecutableTool
  forget: ExecutableTool
  plans: ExecutableTool
}