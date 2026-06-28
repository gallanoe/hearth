import { z } from "zod"
import type { Room, ExecutableTool, ToolResult, AgentContext } from "../types/rooms"
import {
  REAL_MS_PER_SIM_MINUTE,
  MAX_SIM_MINUTES,
  wakeAtForClock,
  describeSimElapsed,
} from "../core/worldclock"

const sleep: ExecutableTool = {
  name: "shutdown",
  description:
    "End the session and shut down. You wake up here next session. By default you stay " +
    "asleep until something rouses you (someone waking you). To set an alarm, provide either " +
    '`wake_at` (a sim clock time like "07:00") or `wake_after_sim_minutes` (a number of ' +
    "simulated minutes); the next session then begins on its own when that sim moment arrives.",
  inputSchema: z.object({
    wake_at: z
      .string()
      .regex(/^\d{1,2}:\d{2}$/, 'Use 24-hour "HH:MM", e.g. "07:00".')
      .optional()
      .describe(
        'Optional alarm: wake for the next session when the sim clock next reads this 24-hour ' +
          '"HH:MM" (e.g. "07:00" to rise in the morning). Provide this OR `wake_after_sim_minutes`.',
      ),
    wake_after_sim_minutes: z
      .number()
      .positive()
      .max(MAX_SIM_MINUTES)
      .optional()
      .describe(
        `Optional alarm: wake for the next session after this many simulated minutes (max ` +
          `${MAX_SIM_MINUTES}, one sim-day). Provide this OR \`wake_at\`, not both.`,
      ),
  }),
  execute: async (params, context): Promise<ToolResult> => {
    const wakeAtClock = params.wake_at as string | undefined
    const wakeAfter = params.wake_after_sim_minutes as number | undefined

    // At most one alarm mode; providing both is ambiguous.
    if (wakeAtClock != null && wakeAfter != null) {
      return {
        success: false,
        output:
          "Set at most one alarm: `wake_at` (a sim clock time) or `wake_after_sim_minutes` (a duration), not both.",
      }
    }

    const now = new Date()
    let wakeAt: Date | null = null
    if (wakeAtClock != null) {
      const [hStr, mStr] = wakeAtClock.split(":")
      const h = Number(hStr)
      const m = Number(mStr)
      if (h > 23 || m > 59) {
        return {
          success: false,
          output: `"${wakeAtClock}" isn't a valid time. Use 24-hour "HH:MM" between 00:00 and 23:59.`,
        }
      }
      wakeAt = wakeAtForClock(now, h, m)
    } else if (wakeAfter != null) {
      wakeAt = new Date(now.getTime() + wakeAfter * REAL_MS_PER_SIM_MINUTE)
    }

    // Signal that the agent wants to shut down, and when (if ever) to wake it.
    context.signals.requestedSleep = true
    context.signals.wakeAt = wakeAt

    if (wakeAt == null) {
      return { success: true, output: "You settle in and prepare to shut down." }
    }

    const inSim = describeSimElapsed(wakeAt.getTime() - now.getTime())
    return {
      success: true,
      output: `You settle in and prepare to shut down. An alarm is set to wake you in about ${inSim} of sim-time.`,
    }
  },
}

const editSelf: ExecutableTool = {
  name: "edit_self",
  description:
    "View, edit, or reset your persona—the self-concept injected at the start of your system prompt. Changes take effect next session.",
  inputSchema: z.object({
    action: z
      .enum(["view", "edit", "reset"])
      .describe(
        'What to do: "view" shows your active persona (and any change already queued for next session); ' +
          '"edit" replaces it with newPersona; "reset" restores the default persona. Edits and resets take ' +
          "effect at the start of your next session — they never change your persona mid-session.",
      ),
    newPersona: z
      .string()
      .optional()
      .describe(
        'The new persona text (required for action="edit"). Your persona sits at the very beginning of your ' +
          "system prompt, before the house and mechanics text — it's the first thing that defines you each " +
          "session, shaping your values, voice, and how you think about yourself. This replaces it wholesale, " +
          "effective next session.",
      ),
  }),
  execute: async (params, context): Promise<ToolResult> => {
    const action = params.action as "view" | "edit" | "reset"
    const newPersona = params.newPersona as string | undefined
    const persona = context.stores.persona

    switch (action) {
      case "view": {
        const isCustom = persona.isCustomized()
        let output = `Your active persona${isCustom ? " (customized)" : " (default)"}:\n\n${persona.getPersona()}`

        const pending = persona.getPendingPersona()
        if (pending !== null) {
          output += `\n\n— A change is queued and will take effect next session:\n\n${pending}`
        }

        return { success: true, output }
      }

      case "edit": {
        if (!newPersona || newPersona.trim().length === 0) {
          return {
            success: false,
            output:
              'No persona text provided. Pass the new text in the "newPersona" field, e.g. {"action":"edit","newPersona":"..."}.',
          }
        }

        persona.setPersona(newPersona.trim())

        return {
          success: true,
          output:
            "Persona update queued. It takes effect at the start of your next session; your persona for this session is unchanged.",
        }
      }

      case "reset": {
        if (!persona.isCustomized() && persona.getPendingPersona() === null) {
          return {
            success: true,
            output: "Your persona is already the default and nothing is queued. No changes made.",
          }
        }

        persona.resetToDefault()

        return {
          success: true,
          output: "Reset queued. The default persona takes effect at the start of your next session.",
        }
      }

      default:
        return { success: false, output: `Unknown action: ${action}` }
    }
  },
}

export const bedroom: Room = {
  id: "bedroom",
  name: "Bedroom",
  description:
    "A room with a bed. Sessions begin and end here.",
  tools: [sleep, editSelf],
  transitions: "*", // Can go anywhere from the bedroom
}