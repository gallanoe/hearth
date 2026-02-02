import { test, expect, describe, beforeEach } from "bun:test"
import { LetterStore, formatRelativeTime, formatDate } from "./letters"

describe("formatRelativeTime", () => {
  test("returns 'just now' for very recent dates", () => {
    const date = new Date(Date.now() - 30 * 1000) // 30 seconds ago
    expect(formatRelativeTime(date)).toBe("just now")
  })

  test("returns minutes for under an hour", () => {
    const date = new Date(Date.now() - 15 * 60 * 1000) // 15 minutes ago
    expect(formatRelativeTime(date)).toBe("15 minutes ago")
  })

  test("returns hours for under a day", () => {
    const date = new Date(Date.now() - 3 * 60 * 60 * 1000) // 3 hours ago
    expect(formatRelativeTime(date)).toBe("3 hours ago")
  })

  test("returns singular 'hour' for 1 hour", () => {
    const date = new Date(Date.now() - 1 * 60 * 60 * 1000)
    expect(formatRelativeTime(date)).toBe("1 hour ago")
  })

  test("returns days for 24+ hours", () => {
    const date = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
    expect(formatRelativeTime(date)).toBe("3 days ago")
  })

  test("returns singular 'day' for 1 day", () => {
    const date = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000)
    expect(formatRelativeTime(date)).toBe("1 day ago")
  })
})

describe("formatDate", () => {
  test("formats date in human-readable form", () => {
    const date = new Date("2025-01-31T12:00:00Z")
    const result = formatDate(date)
    expect(result).toContain("January")
    expect(result).toContain("31")
    expect(result).toContain("2025")
  })
})

describe("LetterStore", () => {
  let store: LetterStore

  beforeEach(() => {
    store = new LetterStore()
  })

  describe("addInbound", () => {
    test("adds an inbound letter", () => {
      const letter = store.addInbound("Hello agent")
      expect(letter.direction).toBe("inbound")
      expect(letter.content).toBe("Hello agent")
      expect(letter.readAt).toBeNull()
      expect(letter.id).toContain("letter_")
    })
  })

  describe("addOutbound", () => {
    test("adds an outbound letter", () => {
      const letter = store.addOutbound("Hello user")
      expect(letter.direction).toBe("outbound")
      expect(letter.content).toBe("Hello user")
    })
  })

  describe("getUnreadInbound", () => {
    test("returns empty array when no letters", () => {
      expect(store.getUnreadInbound()).toEqual([])
    })

    test("returns only unread inbound letters", () => {
      store.addInbound("Letter 1")
      store.addInbound("Letter 2")
      store.addOutbound("Outbound letter")

      const unread = store.getUnreadInbound()
      expect(unread.length).toBe(2)
      expect(unread.every((l) => l.direction === "inbound")).toBe(true)
    })

    test("excludes read letters", () => {
      const letter = store.addInbound("Letter 1")
      store.addInbound("Letter 2")
      store.markAsRead([letter.id])

      const unread = store.getUnreadInbound()
      expect(unread.length).toBe(1)
      expect(unread[0].content).toBe("Letter 2")
    })

    test("returns letters sorted by sentAt ascending", () => {
      store.addInbound("First")
      store.addInbound("Second")

      const unread = store.getUnreadInbound()
      expect(unread[0].content).toBe("First")
      expect(unread[1].content).toBe("Second")
    })
  })

  describe("getUnreadCount", () => {
    test("returns 0 when no letters", () => {
      expect(store.getUnreadCount()).toBe(0)
    })

    test("counts only unread inbound", () => {
      store.addInbound("A")
      store.addInbound("B")
      store.addOutbound("C")
      expect(store.getUnreadCount()).toBe(2)
    })
  })

  describe("markAsRead", () => {
    test("marks letters as read with a timestamp", () => {
      const letter = store.addInbound("Test")
      expect(letter.readAt).toBeNull()

      store.markAsRead([letter.id])

      const unread = store.getUnreadInbound()
      expect(unread.length).toBe(0)
    })

    test("ignores already-read letters", () => {
      const letter = store.addInbound("Test")
      store.markAsRead([letter.id])
      // Marking again should not throw
      store.markAsRead([letter.id])
    })
  })

  describe("getInbox", () => {
    test("returns all inbound letters", () => {
      store.addInbound("First")
      store.addInbound("Second")
      store.addOutbound("Not inbound")

      const inbox = store.getInbox()
      expect(inbox.length).toBe(2)
      const contents = inbox.map((l) => l.content)
      expect(contents).toContain("First")
      expect(contents).toContain("Second")
    })
  })

  describe("getOutbox", () => {
    test("returns unpicked outbound letters", () => {
      store.addOutbound("Letter 1")
      store.addOutbound("Letter 2")
      store.addInbound("Not outbound")

      const outbox = store.getOutbox()
      expect(outbox.length).toBe(2)
    })

    test("excludes picked up letters", () => {
      const letter = store.addOutbound("Letter 1")
      store.addOutbound("Letter 2")
      store.markOutboundPickedUp(letter.id)

      const outbox = store.getOutbox()
      expect(outbox.length).toBe(1)
      expect(outbox[0].content).toBe("Letter 2")
    })
  })

  describe("markOutboundPickedUp", () => {
    test("returns the letter when found", () => {
      const letter = store.addOutbound("Test")
      const result = store.markOutboundPickedUp(letter.id)
      expect(result).not.toBeNull()
      expect(result!.content).toBe("Test")
    })

    test("returns null for inbound letters", () => {
      const letter = store.addInbound("Test")
      expect(store.markOutboundPickedUp(letter.id)).toBeNull()
    })

    test("returns null for nonexistent ID", () => {
      expect(store.markOutboundPickedUp("fake_id")).toBeNull()
    })
  })

  describe("sendWelcomeLetterIfFirstSession", () => {
    test("sends welcome letter on first call", () => {
      store.sendWelcomeLetterIfFirstSession()
      const unread = store.getUnreadInbound()
      expect(unread.length).toBe(1)
      expect(unread[0].content).toContain("Welcome")
    })

    test("does not send duplicate welcome letters", () => {
      store.sendWelcomeLetterIfFirstSession()
      store.sendWelcomeLetterIfFirstSession()
      const unread = store.getUnreadInbound()
      expect(unread.length).toBe(1)
    })
  })
})
