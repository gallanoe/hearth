/**
 * World clock: maps real (UTC) time onto the simulation's day cycle.
 *
 * One simulated day elapses every real hour — 60 real minutes == 24 sim hours,
 * so a sim hour passes every 2.5 real minutes. The cycle is anchored to the top
 * of each real UTC hour (sim-midnight == HH:00:00 UTC), which makes the mapping
 * deterministic and dependency-free: the current timestamp modulo one hour.
 *
 * The readout is surfaced to the agent only as an ephemeral trailing note (see
 * {@link import("../types/llm").LLMCallOptions.trailingNote}): it is never
 * persisted, so the conversation only ever holds the current moment's time.
 */

/** Real milliseconds per simulated day (one hour). */
export const REAL_MS_PER_SIM_DAY = 60 * 60 * 1000

/** Real milliseconds per simulated minute, derived from the day length. */
export const REAL_MS_PER_SIM_MINUTE = REAL_MS_PER_SIM_DAY / (24 * 60)

/** Hard ceiling on a single timed wait or sleep alarm: one full simulated day. */
export const MAX_SIM_MINUTES = 24 * 60

export interface SimTime {
  /** Hour of the simulated day, in [0, 24). */
  hourOfDay: number
  /** Coarse phase of the day, e.g. "morning". */
  phase: string
  /** Sim wall-clock, formatted "HH:MM". */
  clock: string
}

/** The phase label for a given sim hour-of-day. */
function phaseOf(hourOfDay: number): string {
  if (hourOfDay < 5) return "night"
  if (hourOfDay < 7) return "dawn"
  if (hourOfDay < 11) return "morning"
  if (hourOfDay < 13) return "midday"
  if (hourOfDay < 17) return "afternoon"
  if (hourOfDay < 20) return "evening"
  if (hourOfDay < 22) return "dusk"
  return "night"
}

/** Convert a real instant to the simulation's time of day. */
export function simTimeOf(now: Date): SimTime {
  // Modulo one real hour, normalized to [0, REAL_MS_PER_SIM_DAY) even for
  // pre-epoch dates where `%` can go negative.
  const msIntoDay = ((now.getTime() % REAL_MS_PER_SIM_DAY) + REAL_MS_PER_SIM_DAY) % REAL_MS_PER_SIM_DAY
  const hourOfDay = (msIntoDay / REAL_MS_PER_SIM_DAY) * 24
  const h = Math.floor(hourOfDay)
  const m = Math.floor((hourOfDay - h) * 60)
  const clock = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
  return { hourOfDay, phase: phaseOf(hourOfDay), clock }
}

/**
 * The ephemeral time-of-day note appended to the tail of each turn's request.
 * Volatile by design — not persisted (see LLMCallOptions.trailingNote).
 */
export function buildTimeNote(now: Date): string {
  const { phase, clock } = simTimeOf(now)
  return `It is ${phase} (${clock}).`
}

/**
 * The real (UTC) instant at which the sim clock next reads `HH:MM`.
 *
 * The sim clock is a pure function of UTC — one sim-day per real hour, anchored
 * to the top of each real hour — so "the next time the sim clock shows this
 * time-of-day" inverts to a single timestamp. No polling, no cron: callers
 * compute the one moment and set one timer for it. This is the inverse of
 * {@link simTimeOf}, shared by the `wait` tool and the `shutdown` wake alarm.
 */
export function wakeAtForClock(now: Date, hour: number, minute: number): Date {
  const targetHourOfDay = hour + minute / 60
  const targetIntoCycle = (targetHourOfDay / 24) * REAL_MS_PER_SIM_DAY
  const nowMs = now.getTime()
  const nowIntoCycle = ((nowMs % REAL_MS_PER_SIM_DAY) + REAL_MS_PER_SIM_DAY) % REAL_MS_PER_SIM_DAY
  let delta = (((targetIntoCycle - nowIntoCycle) % REAL_MS_PER_SIM_DAY) + REAL_MS_PER_SIM_DAY) % REAL_MS_PER_SIM_DAY
  // Already exactly at the target → wait for the next occurrence, not zero.
  if (delta === 0) delta = REAL_MS_PER_SIM_DAY
  return new Date(nowMs + delta)
}

/**
 * Human, sim-scaled description of a real elapsed duration. Reports cumulative
 * sim-time (real ms scaled up 24×) rather than a difference of clock readings,
 * which would wrap and under-report for spans longer than one real hour.
 */
export function describeSimElapsed(realMs: number): string {
  const simMinutes = Math.round(realMs / REAL_MS_PER_SIM_MINUTE)
  if (simMinutes < 1) return "less than a minute"
  if (simMinutes < 60) return `${simMinutes} minute${simMinutes === 1 ? "" : "s"}`
  const h = Math.floor(simMinutes / 60)
  const m = simMinutes % 60
  const hours = `${h} hour${h === 1 ? "" : "s"}`
  if (m === 0) return hours
  return `${hours} and ${m} minute${m === 1 ? "" : "s"}`
}
