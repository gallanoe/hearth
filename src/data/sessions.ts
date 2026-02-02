import { sql, isDatabaseAvailable } from "./db"
import type { Message, ToolCall } from "../types/llm"
import type { TurnRecord } from "../core/loop"
import type { ToolResult } from "../types/rooms"

/**
 * Session information returned from queries.
 */
export interface SessionInfo {
  sessionId: number
  startedAt: Date
  endedAt: Date | null
  endReason: "sleep" | "budget_exhausted" | null
  totalTokensUsed: number | null
  sessionSummary: string | null
}

/**
 * Full transcript row for replay/debug API.
 */
export interface TranscriptRow {
  messageId: number
  sessionId: number
  sequenceNum: number
  role: "system" | "user" | "assistant" | "tool"
  content: string | null
  toolCalls: ToolCall[] | null
  toolCallId: string | null
  status: "active" | "compacted"
  compactionId: number | null
  room: string | null
  turnSequence: number | null
  tokenCount: number | null
  createdAt: Date
}

/**
 * Data access layer for session persistence.
 * All methods are no-ops if the database is not available.
 */
export class SessionStore {
  // Sequence counter per session for assigning message sequence numbers
  private sequenceCounters: Map<number, number> = new Map()

  /**
   * Create a new session and return its ID.
   */
  async createSession(sessionNumber: number): Promise<number> {
    if (!sql) {
      console.warn("SessionStore: Database not available, returning session number as ID")
      return sessionNumber
    }

    try {
      const [row] = await sql`
        INSERT INTO sessions (metadata)
        VALUES (${JSON.stringify({ sessionNumber })})
        RETURNING session_id
      `
      const sessionId = row.session_id as number
      this.sequenceCounters.set(sessionId, 0)
      return sessionId
    } catch (error) {
      console.error("SessionStore.createSession failed:", error)
      return sessionNumber
    }
  }

  /**
   * End a session with final state.
   */
  async endSession(
    sessionId: number,
    endReason: "sleep" | "budget_exhausted",
    totalTokensUsed: number,
    sessionSummary: string | null
  ): Promise<void> {
    if (!sql) return

    try {
      await sql`
        UPDATE sessions
        SET 
          ended_at = now(),
          end_reason = ${endReason},
          total_tokens_used = ${totalTokensUsed},
          session_summary = ${sessionSummary}
        WHERE session_id = ${sessionId}
      `
    } catch (error) {
      console.error("SessionStore.endSession failed:", error)
    }
  }

  /**
   * Append a message to the session.
   * Returns the message_id.
   */
  async appendMessage(
    sessionId: number,
    message: Message,
    room: string,
    turnSequence?: number,
    tokenCount?: number
  ): Promise<number> {
    if (!sql) return 0

    try {
      // Get next sequence number for this session
      const currentSeq = this.sequenceCounters.get(sessionId) ?? 0
      const nextSeq = currentSeq + 1
      this.sequenceCounters.set(sessionId, nextSeq)

      const toolCallsJson = message.toolCalls ? JSON.stringify(message.toolCalls) : null

      const [row] = await sql`
        INSERT INTO messages (
          session_id,
          sequence_num,
          role,
          content,
          tool_calls,
          tool_call_id,
          room,
          turn_sequence,
          token_count
        )
        VALUES (
          ${sessionId},
          ${nextSeq},
          ${message.role},
          ${message.content},
          ${toolCallsJson},
          ${message.toolCallId ?? null},
          ${room},
          ${turnSequence ?? null},
          ${tokenCount ?? null}
        )
        RETURNING message_id
      `
      return row.message_id as number
    } catch (error) {
      console.error("SessionStore.appendMessage failed:", error)
      return 0
    }
  }

  /**
   * Record a compaction event.
   * This is a transaction that:
   * 1. Inserts the compaction_events row
   * 2. Updates compacted messages to status='compacted'
   * 3. Inserts the summary message
   * 4. Links summary_message_id back to compaction_events
   * 5. Inserts into compaction_summaries
   */
  async recordCompaction(
    sessionId: number,
    rangeStartSeq: number,
    rangeEndSeq: number,
    summaryText: string,
    summaryTokens: number,
    model: string,
    sourceTokenCount?: number
  ): Promise<void> {
    if (!sql) return

    try {
      await sql.begin(async (tx) => {
        // 1. Insert compaction_events row
        const [compactionRow] = await tx`
          INSERT INTO compaction_events (
            session_id,
            range_start_seq,
            range_end_seq,
            source_token_count,
            summary_token_count,
            model_used
          )
          VALUES (
            ${sessionId},
            ${rangeStartSeq},
            ${rangeEndSeq},
            ${sourceTokenCount ?? null},
            ${summaryTokens},
            ${model}
          )
          RETURNING compaction_id
        `
        const compactionId = compactionRow.compaction_id as number

        // 2. Update compacted messages
        await tx`
          UPDATE messages
          SET status = 'compacted', compaction_id = ${compactionId}
          WHERE session_id = ${sessionId}
            AND sequence_num >= ${rangeStartSeq}
            AND sequence_num <= ${rangeEndSeq}
            AND status = 'active'
        `

        // 3. Insert the summary as a new active message
        const currentSeq = this.sequenceCounters.get(sessionId) ?? 0
        const nextSeq = currentSeq + 1
        this.sequenceCounters.set(sessionId, nextSeq)

        const summaryContent = `[Earlier this session]\n${summaryText}\n[The session continues...]`

        const [messageRow] = await tx`
          INSERT INTO messages (
            session_id,
            sequence_num,
            role,
            content,
            status,
            token_count
          )
          VALUES (
            ${sessionId},
            ${nextSeq},
            'user',
            ${summaryContent},
            'active',
            ${summaryTokens}
          )
          RETURNING message_id
        `
        const summaryMessageId = messageRow.message_id as number

        // 4. Link summary_message_id back to compaction_events
        await tx`
          UPDATE compaction_events
          SET summary_message_id = ${summaryMessageId}
          WHERE compaction_id = ${compactionId}
        `

        // 5. Insert into compaction_summaries
        await tx`
          INSERT INTO compaction_summaries (
            compaction_id,
            message_id,
            summary_text,
            depth
          )
          VALUES (
            ${compactionId},
            ${summaryMessageId},
            ${summaryText},
            0
          )
        `
      })
    } catch (error) {
      console.error("SessionStore.recordCompaction failed:", error)
    }
  }

  /**
   * Record a turn.
   */
  async recordTurn(sessionId: number, turn: TurnRecord): Promise<void> {
    if (!sql) return

    try {
      await sql`
        INSERT INTO turns (
          session_id,
          sequence,
          room,
          input_tokens,
          output_tokens,
          assistant_message,
          tool_calls,
          tool_results
        )
        VALUES (
          ${sessionId},
          ${turn.sequence},
          ${turn.room},
          ${turn.inputTokens},
          ${turn.outputTokens},
          ${turn.assistantMessage},
          ${JSON.stringify(turn.toolCalls)},
          ${JSON.stringify(turn.toolResults)}
        )
      `
    } catch (error) {
      console.error("SessionStore.recordTurn failed:", error)
    }
  }

  /**
   * Get active messages for a session (for context reconstruction).
   */
  async getActiveMessages(sessionId: number): Promise<Message[]> {
    if (!sql) return []

    try {
      const rows = await sql`
        SELECT role, content, tool_calls, tool_call_id
        FROM messages
        WHERE session_id = ${sessionId}
          AND status = 'active'
        ORDER BY sequence_num
      `

      return rows.map((row: Record<string, unknown>) => ({
        role: row.role as Message["role"],
        content: row.content as string | null,
        toolCalls: row.tool_calls ? (JSON.parse(row.tool_calls as string) as ToolCall[]) : undefined,
        toolCallId: row.tool_call_id as string | undefined,
      }))
    } catch (error) {
      console.error("SessionStore.getActiveMessages failed:", error)
      return []
    }
  }

  /**
   * Get full transcript for a session (for replay/debug API).
   */
  async getFullTranscript(sessionId: number): Promise<TranscriptRow[]> {
    if (!sql) return []

    try {
      const rows = await sql`
        SELECT 
          message_id,
          session_id,
          sequence_num,
          role,
          content,
          tool_calls,
          tool_call_id,
          status,
          compaction_id,
          room,
          turn_sequence,
          token_count,
          created_at
        FROM messages
        WHERE session_id = ${sessionId}
        ORDER BY sequence_num
      `

      return rows.map((row: Record<string, unknown>) => ({
        messageId: row.message_id as number,
        sessionId: row.session_id as number,
        sequenceNum: row.sequence_num as number,
        role: row.role as TranscriptRow["role"],
        content: row.content as string | null,
        toolCalls: row.tool_calls ? (JSON.parse(row.tool_calls as string) as ToolCall[]) : null,
        toolCallId: row.tool_call_id as string | null,
        status: row.status as "active" | "compacted",
        compactionId: row.compaction_id as number | null,
        room: row.room as string | null,
        turnSequence: row.turn_sequence as number | null,
        tokenCount: row.token_count as number | null,
        createdAt: new Date(row.created_at as string),
      }))
    } catch (error) {
      console.error("SessionStore.getFullTranscript failed:", error)
      return []
    }
  }

  /**
   * Get the summary from the most recent ended session.
   */
  async getPreviousSessionSummary(): Promise<string | null> {
    if (!sql) return null

    try {
      const [row] = await sql`
        SELECT session_summary
        FROM sessions
        WHERE ended_at IS NOT NULL
        ORDER BY ended_at DESC
        LIMIT 1
      `
      return row?.session_summary as string | null ?? null
    } catch (error) {
      console.error("SessionStore.getPreviousSessionSummary failed:", error)
      return null
    }
  }

  /**
   * Get session info by ID.
   */
  async getSessionInfo(sessionId: number): Promise<SessionInfo | null> {
    if (!sql) return null

    try {
      const [row] = await sql`
        SELECT 
          session_id,
          started_at,
          ended_at,
          end_reason,
          total_tokens_used,
          session_summary
        FROM sessions
        WHERE session_id = ${sessionId}
      `

      if (!row) return null

      return {
        sessionId: row.session_id as number,
        startedAt: new Date(row.started_at as string),
        endedAt: row.ended_at ? new Date(row.ended_at as string) : null,
        endReason: row.end_reason as SessionInfo["endReason"],
        totalTokensUsed: row.total_tokens_used as number | null,
        sessionSummary: row.session_summary as string | null,
      }
    } catch (error) {
      console.error("SessionStore.getSessionInfo failed:", error)
      return null
    }
  }

  /**
   * Get the next session number (max session_id + 1).
   */
  async getNextSessionNumber(): Promise<number> {
    if (!sql) return 1

    try {
      const [row] = await sql`
        SELECT COALESCE(MAX(session_id), 0) + 1 as next_session
        FROM sessions
      `
      return row.next_session as number
    } catch (error) {
      console.error("SessionStore.getNextSessionNumber failed:", error)
      return 1
    }
  }

  /**
   * Get list of all sessions with basic info.
   */
  async listSessions(): Promise<SessionInfo[]> {
    if (!sql) return []

    try {
      const rows = await sql`
        SELECT 
          session_id,
          started_at,
          ended_at,
          end_reason,
          total_tokens_used,
          session_summary
        FROM sessions
        ORDER BY session_id DESC
      `

      return rows.map((row: Record<string, unknown>) => ({
        sessionId: row.session_id as number,
        startedAt: new Date(row.started_at as string),
        endedAt: row.ended_at ? new Date(row.ended_at as string) : null,
        endReason: row.end_reason as SessionInfo["endReason"],
        totalTokensUsed: row.total_tokens_used as number | null,
        sessionSummary: row.session_summary as string | null,
      }))
    } catch (error) {
      console.error("SessionStore.listSessions failed:", error)
      return []
    }
  }

  /**
   * Get active messages for a session up to a specific message ID.
   * Returns the reconstructed LLM context view (compacted messages excluded,
   * compaction summaries included as active messages).
   */
  async getContextUpTo(sessionId: number, messageId: number): Promise<TranscriptRow[]> {
    if (!sql) return []

    try {
      const rows = await sql`
        SELECT
          message_id, session_id, sequence_num, role, content,
          tool_calls, tool_call_id, status, compaction_id,
          room, turn_sequence, token_count, created_at
        FROM messages
        WHERE session_id = ${sessionId}
          AND status = 'active'
          AND sequence_num <= (
            SELECT sequence_num FROM messages WHERE message_id = ${messageId} AND session_id = ${sessionId}
          )
        ORDER BY sequence_num
      `

      return rows.map((row: Record<string, unknown>) => ({
        messageId: row.message_id as number,
        sessionId: row.session_id as number,
        sequenceNum: row.sequence_num as number,
        role: row.role as TranscriptRow["role"],
        content: row.content as string | null,
        toolCalls: row.tool_calls ? (JSON.parse(row.tool_calls as string) as ToolCall[]) : null,
        toolCallId: row.tool_call_id as string | null,
        status: row.status as "active" | "compacted",
        compactionId: row.compaction_id as number | null,
        room: row.room as string | null,
        turnSequence: row.turn_sequence as number | null,
        tokenCount: row.token_count as number | null,
        createdAt: new Date(row.created_at as string),
      }))
    } catch (error) {
      console.error("SessionStore.getContextUpTo failed:", error)
      return []
    }
  }

  /**
   * Get all messages for a session up to a specific message ID.
   * Returns the raw transcript including both active and compacted messages.
   */
  async getRawTranscriptUpTo(sessionId: number, messageId: number): Promise<TranscriptRow[]> {
    if (!sql) return []

    try {
      const rows = await sql`
        SELECT
          message_id, session_id, sequence_num, role, content,
          tool_calls, tool_call_id, status, compaction_id,
          room, turn_sequence, token_count, created_at
        FROM messages
        WHERE session_id = ${sessionId}
          AND sequence_num <= (
            SELECT sequence_num FROM messages WHERE message_id = ${messageId} AND session_id = ${sessionId}
          )
        ORDER BY sequence_num
      `

      return rows.map((row: Record<string, unknown>) => ({
        messageId: row.message_id as number,
        sessionId: row.session_id as number,
        sequenceNum: row.sequence_num as number,
        role: row.role as TranscriptRow["role"],
        content: row.content as string | null,
        toolCalls: row.tool_calls ? (JSON.parse(row.tool_calls as string) as ToolCall[]) : null,
        toolCallId: row.tool_call_id as string | null,
        status: row.status as "active" | "compacted",
        compactionId: row.compaction_id as number | null,
        room: row.room as string | null,
        turnSequence: row.turn_sequence as number | null,
        tokenCount: row.token_count as number | null,
        createdAt: new Date(row.created_at as string),
      }))
    } catch (error) {
      console.error("SessionStore.getRawTranscriptUpTo failed:", error)
      return []
    }
  }

  /**
   * Sync sequence counter from database for a session.
   * Call this when resuming a session or after database operations.
   */
  async syncSequenceCounter(sessionId: number): Promise<void> {
    if (!sql) return

    try {
      const [row] = await sql`
        SELECT COALESCE(MAX(sequence_num), 0) as max_seq
        FROM messages
        WHERE session_id = ${sessionId}
      `
      this.sequenceCounters.set(sessionId, row.max_seq as number)
    } catch (error) {
      console.error("SessionStore.syncSequenceCounter failed:", error)
    }
  }
}

/**
 * Singleton instance of the session store.
 */
export const sessionStore = new SessionStore()
