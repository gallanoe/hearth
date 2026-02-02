/**
 * Centralized configuration for the Hearth application.
 * All magic numbers and environment-driven values live here.
 */

// --- Session Budget ---

export const DEFAULT_BUDGET = {
  totalTokens: 1_000_000,
  warningThreshold: 200_000,
} as const

// --- Context Window & Compaction ---

export const CONTEXT_WINDOW = 200_000 // Model's maximum context size
export const COMPACTION_THRESHOLD = 0.9 // Trigger compaction at 90%
export const RECENT_MESSAGES_TO_KEEP = 10 // Preserve recent messages for continuity
export const COMPACTION_TRIGGER = CONTEXT_WINDOW * COMPACTION_THRESHOLD

// --- Tool Result Decay ---

/** Number of turns to keep full tool results for. */
export const DECAY_TURN_WINDOW = 5
/** Minimum content length (chars) before a tool result is eligible for stubbing. */
export const DECAY_STUB_THRESHOLD = 500

// --- Office Tools ---

export const WORKSPACE_ROOT = process.env.AGENT_WORKSPACE || "/home/agent"
export const DEFAULT_TIMEOUT = 30_000

export const OUTPUT_LIMITS = {
  bash: 10_000,
  read: 50_000,
  fetch: 50_000,
} as const

// --- Library ---

/** Characters per page (~4096 tokens). */
export const PAGE_SIZE = 16384

// --- Server ---

export const SERVER_PORT = 3000
