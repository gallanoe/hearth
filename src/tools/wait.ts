import { z } from "zod"
import type { ExecutableTool, ToolResult } from "../types/rooms"
import type { LetterStore } from "../data/letters"
import { REAL_MS_PER_SIM_DAY, buildTimeNote } from "../core/worldclock"

/** Real milliseconds per simulated minute, derived from the day length. */
const REAL_MS_PER_SIM_MINUTE = REAL_MS_PER_SIM_DAY / (24 * 60)

/** Hard ceiling on a single wait: one full simulated day. */
const MAX_SIM_MINUTES = 24 * 60

/**
 * The real (UTC) instant at which the sim clock next reads `HH:MM`.
 *
 * The sim clock is a pure function of UTC — one sim-day per real hour, anchored
 * to the top of each real hour (see worldclock.ts) — so "wait until a sim
 * time-of-day" inverts to a single timestamp. No polling, no cron: we compute the
 * one moment and set one timer for it.
 */
function wakeAtForClock(now: Date, hour: number, minute: number): Date {
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
 * which would wrap and under-report for waits longer than one real hour.
 */
function describeSimElapsed(realMs: number): string {
  const simMinutes = Math.round(realMs / REAL_MS_PER_SIM_MINUTE)
  if (simMinutes < 1) return "less than a minute"
  if (simMinutes < 60) return `${simMinutes} minute${simMinutes === 1 ? "" : "s"}`
  const h = Math.floor(simMinutes / 60)
  const m = simMinutes % 60
  const hours = `${h} hour${h === 1 ? "" : "s"}`
  if (m === 0) return hours
  return `${hours} and ${m} minute${m === 1 ? "" : "s"}`
}

/**
 * Park until the wake instant or the next inbound letter, whichever comes first.
 * Resolves with what woke us, then tears down both the timer and the letter
 * subscription so neither can fire again.
 */
function parkUntilWake(wakeAt: Date, letters: LetterStore): Promise<"time" | "letter"> {
  return new Promise((resolve) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout>
    let unsubscribe: () => void

    const finish = (reason: "time" | "letter") => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      unsubscribe()
      resolve(reason)
    }

    const delay = Math.max(0, wakeAt.getTime() - Date.now())
    timer = setTimeout(() => finish("time"), delay)
    unsubscribe = letters.onInbound(() => finish("letter"))
  })
}

/**
 * Let simulated time pass. The agent chooses either a target sim time-of-day
 * (`until`) or a sim-minute duration (`for_sim_minutes`); the turn then parks —
 * the tool result is withheld, so the conversation holds an open tool call —
 * until that sim moment arrives OR a letter lands, then resolves with how much
 * sim-time actually elapsed. No loop changes are needed: the loop already awaits
 * each tool's execute(), so returning late simply pauses the turn.
 *
 * TODO(durability): the parked wait lives only in this process — the timer, the
 * letter subscription, and the in-memory conversation are all in-memory, and
 * runSession has no resume-from-DB-mid-turn path. A restart or crash mid-wait
 * silently drops the session. Acceptable for now; revisit if waits must survive
 * restarts (persist a wakeAt and re-park on boot).
 */
export const wait: ExecutableTool = {
  name: "wait",
  description:
    'Let time pass. Provide either `until` (a sim clock time like "07:00" to wait for) or ' +
    "`for_sim_minutes` (a number of simulated minutes). The turn pauses until that sim time " +
    "arrives or a letter lands, then tells you how much sim-time elapsed. Use it to rest, pass " +
    "an idle stretch, or sleep until morning.",
  inputSchema: z.object({
    until: z
      .string()
      .regex(/^\d{1,2}:\d{2}$/, 'Use 24-hour "HH:MM", e.g. "07:00".')
      .optional()
      .describe('Wait until the sim clock next reads this 24-hour "HH:MM" (e.g. "07:00" for morning).'),
    for_sim_minutes: z
      .number()
      .positive()
      .max(MAX_SIM_MINUTES)
      .optional()
      .describe(
        `Wait this many simulated minutes (max ${MAX_SIM_MINUTES}, one sim-day). Provide this OR \`until\`, not both.`
      ),
    reason: z
      .string()
      .optional()
      .describe("Optional short note on why you're waiting, for your own continuity."),
  }),
  execute: async (params, context): Promise<ToolResult> => {
    const until = params.until as string | undefined
    const forSimMinutes = params.for_sim_minutes as number | undefined

    // Exactly one of the two modes must be given.
    if ((until == null) === (forSimMinutes == null)) {
      return {
        success: false,
        output: "Specify exactly one of `until` (a sim clock time) or `for_sim_minutes` (a duration).",
      }
    }

    const now = new Date()
    let wakeAt: Date
    if (until != null) {
      const [hStr, mStr] = until.split(":")
      const h = Number(hStr)
      const m = Number(mStr)
      if (h > 23 || m > 59) {
        return {
          success: false,
          output: `"${until}" isn't a valid time. Use 24-hour "HH:MM" between 00:00 and 23:59.`,
        }
      }
      wakeAt = wakeAtForClock(now, h, m)
    } else {
      const minutes = forSimMinutes as number
      wakeAt = new Date(now.getTime() + minutes * REAL_MS_PER_SIM_MINUTE)
    }

    // Don't let time drift past a letter that's already waiting to be read.
    if (context.stores.letters.getUnreadCount() > 0) {
      return {
        success: true,
        output: `A letter is already waiting to be read, so you don't rest. ${buildTimeNote(now)}`,
      }
    }

    const started = Date.now()
    const wokenBy = await parkUntilWake(wakeAt, context.stores.letters)
    const elapsed = describeSimElapsed(Date.now() - started)
    const timeNote = buildTimeNote(new Date())

    if (wokenBy === "letter") {
      return {
        success: true,
        output: `A letter arrives, drawing you back after about ${elapsed}. ${timeNote} Read your inbox when you're ready.`,
      }
    }
    return {
      success: true,
      output: `You let about ${elapsed} of sim-time drift by. ${timeNote}`,
    }
  },
}
