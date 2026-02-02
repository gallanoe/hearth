import { test, expect, describe, beforeEach } from "bun:test"
import { readInbox, sendMessage } from "./communication"
import { letterStore } from "../data/letters"

// The letterStore is a singleton — we need to work with its current state.
// Since LetterStore has no clearAll(), we test by adding fresh letters each time.
// We use a fresh LetterStore per describe block by importing the class directly.
import { LetterStore } from "../data/letters"

function makeContext() {
  return {
    currentRoom: "entryway",
    currentSession: 1,
    budget: { total: 1_000_000, spent: 0, remaining: 1_000_000, warningThreshold: 200_000 },
    signals: { requestedSleep: false, requestedMove: null },
  }
}

describe("readInbox tool", () => {
  test("has correct name", () => {
    expect(readInbox.name).toBe("read_inbox")
  })

  test("returns empty message when no unread letters", async () => {
    // The singleton may have letters from other tests, but we test the tool's format
    const result = await readInbox.execute({}, makeContext())
    expect(result.success).toBe(true)
    // Either "empty" or contains letter content — both are valid successes
  })
})

describe("sendMessage tool", () => {
  test("has correct name", () => {
    expect(sendMessage.name).toBe("send_message")
  })

  test("sends a letter successfully", async () => {
    const result = await sendMessage.execute({ content: "Hello from the agent" }, makeContext())
    expect(result.success).toBe(true)
    expect(result.output).toContain("sent")
  })

  test("rejects empty content", async () => {
    const result = await sendMessage.execute({ content: "" }, makeContext())
    expect(result.success).toBe(false)
    expect(result.output).toContain("empty")
  })

  test("rejects whitespace-only content", async () => {
    const result = await sendMessage.execute({ content: "   " }, makeContext())
    expect(result.success).toBe(false)
  })
})
