import { test, expect, describe } from "bun:test"
import { bedroom } from "./bedroom"
import { simTimeOf, REAL_MS_PER_SIM_MINUTE } from "../core/worldclock"
import { makeTestContext } from "../test-helpers"
import type { ExecutableTool } from "../types/rooms"

const shutdown = bedroom.tools.find((t) => t.name === "shutdown") as ExecutableTool

describe("shutdown tool", () => {
  test("with no alarm, requests sleep with no wake time", async () => {
    const ctx = makeTestContext()
    const result = await shutdown.execute({}, ctx)

    expect(result.success).toBe(true)
    expect(ctx.signals.requestedSleep).toBe(true)
    expect(ctx.signals.wakeAt).toBeNull()
  })

  test("wake_after_sim_minutes sets a wake instant that many sim-minutes out", async () => {
    const ctx = makeTestContext()
    const before = Date.now()
    const result = await shutdown.execute({ wake_after_sim_minutes: 30 }, ctx)

    expect(result.success).toBe(true)
    expect(ctx.signals.requestedSleep).toBe(true)
    const delay = ctx.signals.wakeAt!.getTime() - before
    // 30 sim-minutes of real delay, with a little slack for execution time.
    expect(delay).toBeGreaterThanOrEqual(30 * REAL_MS_PER_SIM_MINUTE)
    expect(delay).toBeLessThan(30 * REAL_MS_PER_SIM_MINUTE + 1000)
  })

  test("wake_at sets a wake instant that reads back as the requested sim clock", async () => {
    const ctx = makeTestContext()
    const result = await shutdown.execute({ wake_at: "07:00" }, ctx)

    expect(result.success).toBe(true)
    expect(ctx.signals.wakeAt).not.toBeNull()
    expect(simTimeOf(ctx.signals.wakeAt!).clock).toBe("07:00")
    expect(ctx.signals.wakeAt!.getTime()).toBeGreaterThan(Date.now() - 1)
  })

  test("rejects setting both alarm modes at once, leaving signals untouched", async () => {
    const ctx = makeTestContext()
    const result = await shutdown.execute({ wake_at: "07:00", wake_after_sim_minutes: 30 }, ctx)

    expect(result.success).toBe(false)
    expect(ctx.signals.requestedSleep).toBe(false)
    expect(ctx.signals.wakeAt).toBeNull()
  })

  test("rejects an out-of-range clock time", async () => {
    const ctx = makeTestContext()
    const result = await shutdown.execute({ wake_at: "25:00" }, ctx)

    expect(result.success).toBe(false)
    expect(ctx.signals.requestedSleep).toBe(false)
    expect(ctx.signals.wakeAt).toBeNull()
  })
})
