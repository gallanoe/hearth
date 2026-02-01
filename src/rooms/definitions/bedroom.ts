import { z } from "zod"
import type { Room, ExecutableTool, ToolResult, AgentContext } from "../types"
import { personaStore } from "../../data/persona"

const sleep: ExecutableTool = {
  name: "shutdown",
  description:
    "End the session and shutdown. You will wake up here next session.",
  inputSchema: z.object({}),
  execute: async (_params, context): Promise<ToolResult> => {
    // Signal that the agent wants to shutdown
    context.signals.requestedSleep = true

    return { success: true, output: "You settle in and prepare to shutdown." }
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
        
        return { success: true, output }
      }
      
      case "edit": {
        if (!newPersona || newPersona.trim().length === 0) {
          return {
            success: false,
            output: "Cannot set an empty persona. Please provide the new persona text.",
          }
        }
        
        personaStore.setPersona(newPersona.trim())
        
        return {
          success: true,
          output: `Persona updated successfully.`,
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
        
        personaStore.resetToDefault()
        
        return {
          success: true,
          output: `Persona reset to default. Default persona restored:\n${personaStore.getDefaultPersona()}`,
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
  tools: [sleep, reviewSession, editSelf],
  transitions: "*", // Can go anywhere from the bedroom
}