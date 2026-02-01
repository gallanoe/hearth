import { sql } from "./db"

/**
 * Convert a JS string array to a PostgreSQL array literal.
 * e.g. ["a", "b"] → '{a,b}'
 */
function toPgArray(arr: string[]): string {
  if (arr.length === 0) return "{}"
  // Escape quotes and backslashes in values, then wrap in braces
  const escaped = arr.map((v) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)
  return `{${escaped.join(",")}}`
}

/**
 * A stored memory.
 */
export interface Memory {
  id: number
  content: string
  tags: string[]
  sessionId: number
  room: string
  accessCount: number
  createdAt: Date
}

/**
 * A search result from either explicit memories or session history.
 */
export interface MemorySearchResult {
  memory: Memory
  source: "explicit" | "session"
}

/**
 * In-memory fallback entry when DB is unavailable.
 */
interface InMemoryEntry {
  id: number
  content: string
  tags: string[]
  sessionId: number
  room: string
  accessCount: number
  createdAt: Date
  deletedAt: Date | null
}

/**
 * Persistent memory store with full-text search.
 * Falls back to in-memory storage when the database is unavailable.
 */
export class MemoryStore {
  // In-memory fallback
  private fallback: InMemoryEntry[] = []
  private nextFallbackId = 1

  /**
   * Store a new memory.
   */
  async add(content: string, tags: string[], sessionId: number, room: string): Promise<Memory> {
    if (!sql) {
      const entry: InMemoryEntry = {
        id: this.nextFallbackId++,
        content,
        tags,
        sessionId,
        room,
        accessCount: 0,
        createdAt: new Date(),
        deletedAt: null,
      }
      this.fallback.push(entry)
      return {
        id: entry.id,
        content: entry.content,
        tags: entry.tags,
        sessionId: entry.sessionId,
        room: entry.room,
        accessCount: entry.accessCount,
        createdAt: entry.createdAt,
      }
    }

    try {
      const pgTags = toPgArray(tags)
      const [row] = await sql`
        INSERT INTO memories (content, tags, session_id, room)
        VALUES (${content}, ${pgTags}::text[], ${sessionId}, ${room})
        RETURNING memory_id, content, tags, session_id, room, access_count, created_at
      `
      return {
        id: row.memory_id as number,
        content: row.content as string,
        tags: (row.tags as string[]) ?? [],
        sessionId: row.session_id as number,
        room: row.room as string,
        accessCount: row.access_count as number,
        createdAt: new Date(row.created_at as string),
      }
    } catch (error) {
      console.error("MemoryStore.add failed:", error)
      // Fall back to in-memory
      const entry: InMemoryEntry = {
        id: this.nextFallbackId++,
        content,
        tags,
        sessionId,
        room,
        accessCount: 0,
        createdAt: new Date(),
        deletedAt: null,
      }
      this.fallback.push(entry)
      return {
        id: entry.id,
        content: entry.content,
        tags: entry.tags,
        sessionId: entry.sessionId,
        room: entry.room,
        accessCount: entry.accessCount,
        createdAt: entry.createdAt,
      }
    }
  }

  /**
   * Search memories and optionally session history.
   */
  async search(
    query: string,
    scope: "memories" | "sessions" | "all" = "all",
    limit: number = 5
  ): Promise<MemorySearchResult[]> {
    if (!sql) {
      return this.searchFallback(query, scope, limit)
    }

    try {
      const results: MemorySearchResult[] = []

      // Search explicit memories
      if (scope === "memories" || scope === "all") {
        const memoryRows = await sql`
          SELECT memory_id, content, tags, session_id, room, access_count, created_at
          FROM memories
          WHERE deleted_at IS NULL
            AND (
              to_tsvector('english', content) @@ plainto_tsquery('english', ${query})
              OR EXISTS (
                SELECT 1 FROM unnest(tags) AS tag
                WHERE tag ILIKE ${"%" + query + "%"}
              )
            )
          ORDER BY
            ts_rank(to_tsvector('english', content), plainto_tsquery('english', ${query})) DESC,
            created_at DESC
          LIMIT ${limit}
        `

        const memoryIds: number[] = []
        for (const row of memoryRows) {
          memoryIds.push(row.memory_id as number)
          results.push({
            memory: {
              id: row.memory_id as number,
              content: row.content as string,
              tags: (row.tags as string[]) ?? [],
              sessionId: row.session_id as number,
              room: row.room as string,
              accessCount: row.access_count as number,
              createdAt: new Date(row.created_at as string),
            },
            source: "explicit",
          })
        }

        // Update access counts for returned memories
        if (memoryIds.length > 0) {
          const pgIds = `{${memoryIds.join(",")}}`
          await sql`
            UPDATE memories
            SET access_count = access_count + 1, last_accessed = now()
            WHERE memory_id = ANY(${pgIds}::int[])
          `.catch((err: unknown) => console.error("Failed to update access counts:", err))
        }
      }

      // Search session summaries and compaction summaries
      if (scope === "sessions" || scope === "all") {
        const remaining = limit - results.length
        if (remaining > 0) {
          // Search session summaries
          const sessionRows = await sql`
            (
              SELECT session_summary AS content, started_at AS created_at
              FROM sessions
              WHERE session_summary IS NOT NULL
                AND to_tsvector('english', session_summary) @@ plainto_tsquery('english', ${query})
              ORDER BY started_at DESC
              LIMIT ${remaining}
            )
            UNION ALL
            (
              SELECT summary_text AS content, created_at
              FROM compaction_summaries
              WHERE to_tsvector('english', summary_text) @@ plainto_tsquery('english', ${query})
              ORDER BY created_at DESC
              LIMIT ${remaining}
            )
            ORDER BY created_at DESC
            LIMIT ${remaining}
          `

          for (const row of sessionRows) {
            results.push({
              memory: {
                id: 0,
                content: row.content as string,
                tags: [],
                sessionId: 0,
                room: "",
                accessCount: 0,
                createdAt: new Date(row.created_at as string),
              },
              source: "session",
            })
          }
        }
      }

      return results.slice(0, limit)
    } catch (error) {
      console.error("MemoryStore.search failed:", error)
      return this.searchFallback(query, scope, limit)
    }
  }

  /**
   * Soft-delete a memory by ID.
   */
  async remove(memoryId: number): Promise<boolean> {
    if (!sql) {
      const entry = this.fallback.find((e) => e.id === memoryId && !e.deletedAt)
      if (entry) {
        entry.deletedAt = new Date()
        return true
      }
      return false
    }

    try {
      const result = await sql`
        UPDATE memories
        SET deleted_at = now()
        WHERE memory_id = ${memoryId} AND deleted_at IS NULL
      `
      return (result as unknown as { count: number }).count > 0
    } catch (error) {
      console.error("MemoryStore.remove failed:", error)
      return false
    }
  }

  /**
   * Count of active (non-deleted) memories.
   */
  async getCount(): Promise<number> {
    if (!sql) {
      return this.fallback.filter((e) => !e.deletedAt).length
    }

    try {
      const [row] = await sql`
        SELECT COUNT(*)::int AS count FROM memories WHERE deleted_at IS NULL
      `
      return row.count as number
    } catch (error) {
      console.error("MemoryStore.getCount failed:", error)
      return this.fallback.filter((e) => !e.deletedAt).length
    }
  }

  /**
   * Get distinct tags from recent active memories.
   */
  async getRecentTags(limit: number = 10): Promise<string[]> {
    if (!sql) {
      const active = this.fallback
        .filter((e) => !e.deletedAt)
        .sort((a, b) => b.id - a.id)
        .slice(0, limit)
      const tagSet = new Set<string>()
      for (const entry of active) {
        for (const tag of entry.tags) {
          tagSet.add(tag)
        }
      }
      return Array.from(tagSet)
    }

    try {
      const rows = await sql`
        SELECT DISTINCT unnest(tags) AS tag
        FROM (
          SELECT tags FROM memories
          WHERE deleted_at IS NULL AND array_length(tags, 1) > 0
          ORDER BY created_at DESC
          LIMIT ${limit}
        ) recent
      `
      return rows.map((r: Record<string, unknown>) => r.tag as string)
    } catch (error) {
      console.error("MemoryStore.getRecentTags failed:", error)
      return []
    }
  }

  /**
   * In-memory fallback search using substring matching.
   */
  private searchFallback(
    query: string,
    scope: "memories" | "sessions" | "all",
    limit: number
  ): MemorySearchResult[] {
    if (scope === "sessions") return [] // No session data in-memory

    const lowerQuery = query.toLowerCase()
    const results: MemorySearchResult[] = []

    const active = this.fallback
      .filter((e) => !e.deletedAt)
      .sort((a, b) => b.id - a.id)

    for (const entry of active) {
      if (results.length >= limit) break

      const contentMatch = entry.content.toLowerCase().includes(lowerQuery)
      const tagMatch = entry.tags.some((t) => t.toLowerCase().includes(lowerQuery))

      if (contentMatch || tagMatch) {
        // Update access count in-memory
        entry.accessCount++
        results.push({
          memory: {
            id: entry.id,
            content: entry.content,
            tags: entry.tags,
            sessionId: entry.sessionId,
            room: entry.room,
            accessCount: entry.accessCount,
            createdAt: entry.createdAt,
          },
          source: "explicit",
        })
      }
    }

    return results
  }
}

/**
 * Singleton memory store instance.
 */
export const memoryStore = new MemoryStore()
