import { test, expect, describe } from "bun:test"
import { simTimeOf, buildTimeNote, REAL_MS_PER_SIM_DAY } from "./worldclock"

describe("worldclock", () => {
  test("a real hour maps to a full sim day", () => {
    expect(REAL_MS_PER_SIM_DAY).toBe(60 * 60 * 1000)
  })

  test("top of the real hour is sim-midnight", () => {
    const t = simTimeOf(new Date("2026-06-28T00:00:00Z"))
    expect(t.hourOfDay).toBe(0)
    expect(t.clock).toBe("00:00")
    expect(t.phase).toBe("night")
  })

  test("halfway through the real hour is sim-noon", () => {
    const t = simTimeOf(new Date("2026-06-28T00:30:00Z"))
    expect(t.hourOfDay).toBe(12)
    expect(t.clock).toBe("12:00")
    expect(t.phase).toBe("midday")
  })

  test("phase labels across the day", () => {
    const cases: Array<[string, string, string]> = [
      ["2026-06-28T00:15:00Z", "06:00", "dawn"],
      ["2026-06-28T00:22:30Z", "09:00", "morning"],
      ["2026-06-28T00:45:00Z", "18:00", "evening"],
      ["2026-06-28T00:52:30Z", "21:00", "dusk"],
      ["2026-06-28T00:57:30Z", "23:00", "night"],
    ]
    for (const [iso, clock, phase] of cases) {
      const t = simTimeOf(new Date(iso))
      expect(t.clock).toBe(clock)
      expect(t.phase).toBe(phase)
    }
  })

  test("anchored to the top of each real hour, independent of the hour number", () => {
    const a = simTimeOf(new Date("2026-06-28T13:30:00Z"))
    const b = simTimeOf(new Date("2026-06-28T00:30:00Z"))
    expect(a.clock).toBe("12:00")
    expect(a.clock).toBe(b.clock)
  })

  test("wraps to a new sim day at the next real hour", () => {
    expect(simTimeOf(new Date("2026-06-28T01:00:00Z")).clock).toBe("00:00")
  })

  test("buildTimeNote formats the phase and clock", () => {
    expect(buildTimeNote(new Date("2026-06-28T00:30:00Z"))).toBe("It is midday (12:00).")
  })
})
