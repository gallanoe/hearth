import { test, expect, describe } from "bun:test"
import { decayToolResults, type DecayConfig } from "./decay"
import { DECAY_TURN_WINDOW, DECAY_STUB_THRESHOLD } from "../config"
import type { Message } from "../types/llm"

/** Test-specific config matching original test assumptions. */
const TEST_DECAY: DecayConfig = { turnWindow: 1, stubThreshold: 500 }

/** Helper to create a tool result message with decay metadata. */
function toolMsg(content: string, turn: number, toolName = "read_book"): Message {
  return {
    role: "tool",
    content,
    toolCallId: `call_${turn}`,
    decay: { turn, toolName },
  }
}

/** Helper to create a long string of a given length. */
function longContent(length: number): string {
  return "x".repeat(length)
}

describe("decayToolResults", () => {
  test("stubs tool results older than the decay window", () => {
    const messages: Message[] = [
      toolMsg(longContent(1000), 1),
      { role: "assistant", content: "I read the book." },
      toolMsg(longContent(800), 2),
    ]

    decayToolResults(messages, 3, TEST_DECAY)

    // Turn 1 is older than cutoff (3 - 1 = 2), should be stubbed
    expect(messages[0].content).toBe("[read_book(): returned 1000 chars]")
    // Turn 2 is at cutoff (2 <= 2), should be stubbed
    expect(messages[2].content).toBe("[read_book(): returned 800 chars]")
  })

  test("preserves tool results within the decay window", () => {
    const original = longContent(1000)
    const messages: Message[] = [
      toolMsg(original, 3),
    ]

    decayToolResults(messages, 3, TEST_DECAY)

    // Turn 3 is the current turn, within window — content unchanged
    expect(messages[0].content).toBe(original)
  })

  test("does not stub short tool results below threshold", () => {
    const shortContent = "Success"
    const messages: Message[] = [
      toolMsg(shortContent, 1),
    ]

    decayToolResults(messages, 5, TEST_DECAY)

    // Content is below DECAY_STUB_THRESHOLD, should be untouched
    expect(messages[0].content).toBe(shortContent)
  })

  test("does not touch non-tool messages", () => {
    const messages: Message[] = [
      { role: "user", content: longContent(2000) },
      { role: "assistant", content: longContent(2000) },
      { role: "system", content: longContent(2000) },
    ]

    const originals = messages.map((m) => m.content)
    decayToolResults(messages, 10, TEST_DECAY)

    messages.forEach((m, i) => {
      expect(m.content).toBe(originals[i])
    })
  })

  test("does not touch tool messages without _decay metadata", () => {
    const content = longContent(1000)
    const messages: Message[] = [
      { role: "tool", content, toolCallId: "call_1" },
    ]

    decayToolResults(messages, 10, TEST_DECAY)

    expect(messages[0].content).toBe(content)
  })

  test("mutates messages in place", () => {
    const messages: Message[] = [
      toolMsg(longContent(600), 1),
    ]
    const ref = messages[0]

    decayToolResults(messages, 5, TEST_DECAY)

    // Same object reference, mutated in place
    expect(messages[0]).toBe(ref)
    expect(messages[0].content).toStartWith("[read_book():")
  })

  test("handles multiple turns with mixed eligibility", () => {
    const messages: Message[] = [
      toolMsg(longContent(1000), 1, "fetch"),        // old + long → stub
      { role: "assistant", content: "Fetched." },
      toolMsg("ok", 1, "bash"),                       // old + short → keep
      toolMsg(longContent(2000), 2, "read_book"),     // old + long → stub
      { role: "assistant", content: "Read it." },
      toolMsg(longContent(1500), 3, "read_book"),     // current → keep
    ]

    decayToolResults(messages, 3, TEST_DECAY)

    expect(messages[0].content).toBe("[fetch(): returned 1000 chars]")
    expect(messages[2].content).toBe("ok")
    expect(messages[3].content).toBe("[read_book(): returned 2000 chars]")
    expect(messages[5].content).toBe(longContent(1500))
  })

  test("handles null content gracefully", () => {
    const messages: Message[] = [
      { role: "tool", content: null, toolCallId: "call_1", decay: { turn: 1, toolName: "test" } },
    ]

    // Should not throw
    decayToolResults(messages, 5, TEST_DECAY)
    expect(messages[0].content).toBeNull()
  })

  test("config constants have expected defaults", () => {
    expect(DECAY_TURN_WINDOW).toBe(5)
    expect(DECAY_STUB_THRESHOLD).toBe(500)
  })

  test("content exactly at threshold is not stubbed", () => {
    const exact = longContent(DECAY_STUB_THRESHOLD)
    const messages: Message[] = [
      toolMsg(exact, 1),
    ]

    decayToolResults(messages, 5, TEST_DECAY)

    // length === threshold, not > threshold, so it stays
    expect(messages[0].content).toBe(exact)
  })
})
