/**
 * Letter types and storage for the entryway correspondence system.
 */

export interface Letter {
  id: string
  direction: "inbound" | "outbound"
  content: string
  sentAt: Date
  readAt: Date | null
}

/**
 * Formats a date as a relative time string.
 * - Less than 1 hour: "X minutes ago"
 * - Less than 24 hours: "X hours ago"
 * - 1+ days: "X days ago"
 */
export function formatRelativeTime(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMinutes = Math.floor(diffMs / (1000 * 60))
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffMinutes < 60) {
    if (diffMinutes <= 1) return "just now"
    return `${diffMinutes} minutes ago`
  }

  if (diffHours < 24) {
    return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`
  }

  return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`
}

/**
 * Formats a date in a human-readable format.
 * Example: "January 31, 2025"
 */
export function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })
}

/**
 * Generates a unique letter ID.
 */
function generateId(): string {
  return `letter_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/**
 * In-memory storage for letters.
 * In the future, this will be backed by Postgres.
 */
export class LetterStore {
  private letters: Map<string, Letter> = new Map()
  private pickedUpIds: Set<string> = new Set()

  /**
   * Add an inbound letter (from user to agent).
   */
  addInbound(content: string): Letter {
    const letter: Letter = {
      id: generateId(),
      direction: "inbound",
      content,
      sentAt: new Date(),
      readAt: null,
    }
    this.letters.set(letter.id, letter)
    return letter
  }

  /**
   * Add an outbound letter (from agent to user).
   */
  addOutbound(content: string): Letter {
    const letter: Letter = {
      id: generateId(),
      direction: "outbound",
      content,
      sentAt: new Date(),
      readAt: null,
    }
    this.letters.set(letter.id, letter)
    return letter
  }

  /**
   * Get all unread inbound letters.
   */
  getUnreadInbound(): Letter[] {
    return Array.from(this.letters.values())
      .filter((l) => l.direction === "inbound" && l.readAt === null)
      .sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime())
  }

  /**
   * Get count of unread inbound letters.
   */
  getUnreadCount(): number {
    return this.getUnreadInbound().length
  }

  /**
   * Mark letters as read.
   */
  markAsRead(ids: string[]): void {
    const now = new Date()
    for (const id of ids) {
      const letter = this.letters.get(id)
      if (letter && letter.readAt === null) {
        letter.readAt = now
      }
    }
  }

  /**
   * Get all inbound letters (for API).
   */
  getInbox(): Letter[] {
    return Array.from(this.letters.values())
      .filter((l) => l.direction === "inbound")
      .sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime())
  }

  /**
   * Get all outbound letters that haven't been picked up (for API).
   */
  getOutbox(): Letter[] {
    return Array.from(this.letters.values())
      .filter((l) => l.direction === "outbound" && !this.pickedUpIds.has(l.id))
      .sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime())
  }

  /**
   * Mark an outbound letter as picked up (archives it from outbox).
   * Returns the letter if found, null otherwise.
   */
  markOutboundPickedUp(id: string): Letter | null {
    const letter = this.letters.get(id)
    if (!letter || letter.direction !== "outbound") {
      return null
    }
    this.pickedUpIds.add(id)
    return letter
  }
}

/**
 * Singleton letter store instance.
 */
export const letterStore = new LetterStore()
