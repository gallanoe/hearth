import { test, expect, describe } from "bun:test"
import {
  shouldCompact,
  compactMessages,
  type CompactionResult,
} from "./compaction"
import {
  CONTEXT_WINDOW,
  COMPACTION_THRESHOLD,
  COMPACTION_TRIGGER,
  RECENT_MESSAGES_TO_KEEP,
} from "../config"
import type { Message, LLMProvider, LLMResponse, ToolDefinition } from "../types/llm"

describe("compaction", () => {
  describe("shouldCompact", () => {
    const TEST_TRIGGER = 180_000

    test("returns false when below threshold", () => {
      expect(shouldCompact(100_000, TEST_TRIGGER)).toBe(false)
      expect(shouldCompact(170_000, TEST_TRIGGER)).toBe(false)
    })

    test("returns true when at or above threshold", () => {
      expect(shouldCompact(TEST_TRIGGER, TEST_TRIGGER)).toBe(true)
      expect(shouldCompact(180_000, TEST_TRIGGER)).toBe(true)
      expect(shouldCompact(200_000, TEST_TRIGGER)).toBe(true)
    })

    test("threshold is 90% of context window", () => {
      expect(COMPACTION_THRESHOLD).toBe(0.9)
      expect(COMPACTION_TRIGGER).toBe(CONTEXT_WINDOW * 0.9)
      expect(COMPACTION_TRIGGER).toBe(90_000)
    })
  })

  describe("compactMessages", () => {
    // Mock LLM provider
    const mockLLM: LLMProvider = {
      async send(
        system: string,
        messages: Message[],
        tools?: ToolDefinition[]
      ): Promise<LLMResponse> {
        return {
          content: "Summary: The user discussed various topics including greetings and questions.",
          toolCalls: [],
          stopReason: "stop",
          usage: { inputTokens: 100, outputTokens: 50 },
        }
      },
    }

    test("returns messages unchanged if fewer than RECENT_MESSAGES_TO_KEEP", async () => {
      const messages: Message[] = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there!" },
      ]

      const result = await compactMessages(messages, mockLLM)
      expect(result.messages).toEqual(messages)
      expect(result.messages.length).toBe(2)
      expect(result.originalMessageCount).toBe(2)
      expect(result.compactedMessageCount).toBe(2)
      expect(result.summaryTokens).toBe(0)
    })

    test("compacts messages when above threshold", async () => {
      // Create more messages than RECENT_MESSAGES_TO_KEEP
      const messages: Message[] = []
      for (let i = 0; i < 15; i++) {
        messages.push({ role: "user", content: `Message ${i}` })
        messages.push({ role: "assistant", content: `Response ${i}` })
      }

      const result = await compactMessages(messages, mockLLM)

      // Should have summary + recent messages
      expect(result.messages.length).toBe(RECENT_MESSAGES_TO_KEEP + 1)
      expect(result.compactedMessageCount).toBe(RECENT_MESSAGES_TO_KEEP + 1)
      expect(result.originalMessageCount).toBe(30)
      expect(result.summaryTokens).toBe(50) // From mock LLM

      // First message should be the summary
      expect(result.messages[0].role).toBe("user")
      expect(result.messages[0].content).toContain("[Earlier this session]")
      expect(result.messages[0].content).toContain("Summary:")
    })

    test("preserves the most recent messages", async () => {
      const messages: Message[] = []
      for (let i = 0; i < 20; i++) {
        messages.push({ role: "user", content: `User message ${i}` })
      }

      const result = await compactMessages(messages, mockLLM)

      // The last RECENT_MESSAGES_TO_KEEP messages should be preserved
      const recentOriginal = messages.slice(-RECENT_MESSAGES_TO_KEEP)
      const recentResult = result.messages.slice(1) // Skip the summary

      expect(recentResult).toEqual(recentOriginal)
    })
  })
})
