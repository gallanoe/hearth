import { z } from "zod"
import type { Room, ExecutableTool, ToolResult, AgentContext } from "../types"

const sleep: ExecutableTool = {
  name: "sleep",
  description:
    "End the day and go to sleep. You should set your intentions for tomorrow and optionally write a brief summary of your day. You will wake up here tomorrow.",
  inputSchema: z.object({
    intentions: z
      .string()
      .describe("What you plan to do tomorrow. This will be shown to you when you wake up."),
    summary: z
      .string()
      .optional()
      .describe("Optional brief summary of what you did today."),
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
      output += `\n\nYour day in reflection: ${summary}`
    }
    output += `\n\nYou'll remember: "${intentions}"`

    return { success: true, output }
  },
}

const reviewDay: ExecutableTool = {
  name: "review_day",
  description:
    "Review what you've done today before going to sleep. Shows a summary of your activities and remaining budget.",
  inputSchema: z.object({}),
  execute: async (_params, context): Promise<ToolResult> => {
    const { total, spent, remaining } = context.budget
    const percentUsed = Math.round((spent / total) * 100)

    // TODO: Pull actual activity summary from day's turns
    const output = `Day ${context.currentDay} review:
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
    "Your bedroom. A quiet, simple space with a comfortable bed. This is where you begin and end each day. The morning light filters softly through the curtains.",
  tools: [sleep, reviewDay],
  transitions: "*", // Can go anywhere from the bedroom
  onEnter: async (context) => {
    // Only provide atmospheric text, no prompting
    if (context.budget.remaining <= context.budget.warningThreshold) {
      return "You return to your bedroom. The day has been long, and you feel the weight of it."
    }
    return undefined
  },
}