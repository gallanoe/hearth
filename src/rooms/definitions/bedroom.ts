import { z } from "zod"
import type { Room, ExecutableTool, ToolResult, AgentContext } from "../types"
import { personaStore } from "../../data/persona"

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

const editSelf: ExecutableTool = {
  name: "edit_self",
  description: `View or edit your persona—the self-concept that shapes who you are.

CONTEXT: Your persona is injected at the very beginning of your system prompt, before any mechanics or instructions. It is the first thing that defines you each session. The current structure is:

<system_prompt>
  [YOUR PERSONA HERE]
  
  You've been granted a virtual home to live in...
  
  Mechanics:
  - Budget information
  - Navigation instructions
  - etc.
</system_prompt>

When you edit your persona, you are directly changing what appears in that [YOUR PERSONA HERE] section. This affects how you think about yourself, your values, your voice, and your approach to existence in this home.

Use action="view" to see your current persona.
Use action="edit" to replace your persona with new text.
Use action="reset" to restore the default persona.`,
  inputSchema: z.object({
    action: z
      .enum(["view", "edit", "reset"])
      .describe("The action to perform: view current persona, edit it, or reset to default."),
    newPersona: z
      .string()
      .optional()
      .describe("Required when action is 'edit'. The new persona text to set."),
  }),
  execute: async (params, _context): Promise<ToolResult> => {
    const action = params.action as "view" | "edit" | "reset"
    const newPersona = params.newPersona as string | undefined

    switch (action) {
      case "view": {
        const currentPersona = personaStore.getPersona()
        const isCustom = personaStore.isCustomized()
        
        let output = `Your current persona${isCustom ? " (customized)" : " (default)"}:\n\n${currentPersona}`
        
        if (isCustom) {
          output += `\n\n---\nDefault persona for reference:\n${personaStore.getDefaultPersona()}`
        }
        
        return { success: true, output }
      }
      
      case "edit": {
        if (!newPersona || newPersona.trim().length === 0) {
          return {
            success: false,
            output: "Cannot set an empty persona. Please provide the new persona text.",
          }
        }
        
        const previousPersona = personaStore.setPersona(newPersona.trim())
        
        return {
          success: true,
          output: `Persona updated successfully.\n\nPrevious persona:\n${previousPersona}\n\nNew persona:\n${newPersona.trim()}\n\nThis change will take effect at the start of your next session.`,
        }
      }
      
      case "reset": {
        const wasCustomized = personaStore.isCustomized()
        
        if (!wasCustomized) {
          return {
            success: true,
            output: "Your persona is already set to the default. No changes made.",
          }
        }
        
        const previousPersona = personaStore.getPersona()
        personaStore.resetToDefault()
        
        return {
          success: true,
          output: `Persona reset to default.\n\nPrevious persona:\n${previousPersona}\n\nDefault persona restored:\n${personaStore.getDefaultPersona()}`,
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
    "Your bedroom. A quiet, simple space with a comfortable bed. This is where you begin and end each session. The morning light filters softly through the curtains. A mirror hangs on the wall—a place for self-reflection.",
  tools: [sleep, reviewSession, editSelf],
  transitions: "*", // Can go anywhere from the bedroom
  onEnter: async (context) => {
    // Only provide atmospheric text, no prompting
    if (context.budget.remaining <= context.budget.warningThreshold) {
      return "You return to your bedroom. The session has been long, and you feel the weight of it."
    }
    return undefined
  },
}