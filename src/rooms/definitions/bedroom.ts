import { z } from "zod"
import type { Room, ExecutableTool, ToolResult, AgentContext } from "../types"

const sleep: ExecutableTool = {
  name: "sleep",
  description:
    "End the session and go to sleep. You should set your intentions for next session and optionally write a brief summary of this session. You will wake up here next session.",
  inputSchema: z.object({
    intentions: z
      .string()
      .describe("What you plan to do next session. This will be shown to you when you wake up."),
    summary: z
      .string()
      .optional()
      .describe("Optional brief summary of what you did this session."),
  }),
  execute: async (params, context): Promise<ToolResult> => {
    const intentions = params.intentions as string
    const summary = params.summary as string | undefined

    // Store intentions for next wake-up
    context.intentions = intentions

    // Signal that the agent wants to sleep
    context.signals.requestedSleep = true

    let output = "You settle in and drift off to sleep."
    if (summary) {
      output += `\n\nYour session in reflection: ${summary}`
    }
    output += `\n\nYou'll remember: "${intentions}"`

    return { success: true, output }
  },
}

const reviewSession: ExecutableTool = {
  name: "review_session",
  description:
    "Review what you've done this session before going to sleep. Shows a summary of your activities and remaining budget.",
  inputSchema: z.object({}),
  execute: async (_params, context): Promise<ToolResult> => {
    const { total, spent, remaining } = context.budget
    const percentUsed = Math.round((spent / total) * 100)

    // TODO: Pull actual activity summary from session's turns
    const output = `Session ${context.currentSession} review:
- Budget used: ${spent.toLocaleString()} of ${total.toLocaleString()} tokens (${percentUsed}%)
- Budget remaining: ${remaining.toLocaleString()} tokens

[Activity summary will be populated from turn history]`

    return { success: true, output }
  },
}

export const bedroom: Room = {
  id: "bedroom",
  name: "Bedroom",
  description:
    "Your bedroom. A quiet, simple space with a comfortable bed. This is where you begin and end each session. The morning light filters softly through the curtains.",
  tools: [sleep, reviewSession],
  transitions: "*", // Can go anywhere from the bedroom
  onEnter: async (context) => {
    // Only provide atmospheric text, no prompting
    if (context.budget.remaining <= context.budget.warningThreshold) {
      return "You return to your bedroom. The session has been long, and you feel the weight of it."
    }
    return undefined
  },
}