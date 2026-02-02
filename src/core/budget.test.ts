import { test, expect, describe, beforeEach } from "bun:test"
import { BudgetTracker } from "./budget"

describe("BudgetTracker", () => {
  let tracker: BudgetTracker

  beforeEach(() => {
    tracker = new BudgetTracker({ totalTokens: 1000, warningThreshold: 200 })
  })

  describe("getState", () => {
    test("starts with full budget", () => {
      const state = tracker.getState()
      expect(state.total).toBe(1000)
      expect(state.spent).toBe(0)
      expect(state.remaining).toBe(1000)
      expect(state.warningIssued).toBe(false)
    })
  })

  describe("recordUsage", () => {
    test("tracks token spending", () => {
      tracker.recordUsage(100, 50)
      const state = tracker.getState()
      expect(state.spent).toBe(150)
      expect(state.remaining).toBe(850)
    })

    test("accumulates across multiple calls", () => {
      tracker.recordUsage(100, 50)
      tracker.recordUsage(200, 100)
      expect(tracker.getState().spent).toBe(450)
    })
  })

  describe("isExhausted", () => {
    test("returns false when budget remains", () => {
      tracker.recordUsage(100, 50)
      expect(tracker.isExhausted()).toBe(false)
    })

    test("returns true when budget is exactly spent", () => {
      tracker.recordUsage(500, 500)
      expect(tracker.isExhausted()).toBe(true)
    })

    test("returns true when budget is overspent", () => {
      tracker.recordUsage(600, 600)
      expect(tracker.isExhausted()).toBe(true)
    })
  })

  describe("shouldWarn", () => {
    test("returns false when above threshold", () => {
      tracker.recordUsage(100, 0) // 900 remaining, threshold is 200
      expect(tracker.shouldWarn()).toBe(false)
    })

    test("returns true once when crossing threshold", () => {
      tracker.recordUsage(800, 0) // 200 remaining = at threshold
      expect(tracker.shouldWarn()).toBe(true)
    })

    test("returns false on subsequent calls after warning issued", () => {
      tracker.recordUsage(850, 0)
      tracker.shouldWarn() // triggers warning
      expect(tracker.shouldWarn()).toBe(false)
    })

    test("marks warningIssued in state", () => {
      tracker.recordUsage(850, 0)
      tracker.shouldWarn()
      expect(tracker.getState().warningIssued).toBe(true)
    })
  })

  describe("isLow", () => {
    test("returns false when above threshold", () => {
      tracker.recordUsage(100, 0)
      expect(tracker.isLow()).toBe(false)
    })

    test("returns true when at or below threshold", () => {
      tracker.recordUsage(800, 0)
      expect(tracker.isLow()).toBe(true)
    })

    test("returns true when fully exhausted", () => {
      tracker.recordUsage(1000, 0)
      expect(tracker.isLow()).toBe(true)
    })
  })
})
