import { z } from "zod"
import type { Room, ExecutableTool, ToolResult, AgentContext } from "../types/rooms"

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

const editSelf: ExecutableTool = {
  name: "edit_self",
  description: `View or edit your persona—the self-concept that shapes who you are.

CONTEXT: Your persona is injected at the very beginning of your system prompt, before any mechanics or instructions. It is the first thing that defines you each session. The current structure is:

<system_prompt>
  [YOUR PERSONA HERE]
  
  You've been granted a virtual home to live in...
  
  Mechanics:
  - Navigation instructions
  - etc.
</system_prompt>

When you edit your persona, you are directly changing what appears in that [YOUR PERSONA HERE] section. This affects how you think about yourself, your values, your voice, and your approach to existence in this home.

Use action="view" to see your active persona (and any change already queued for next session).
Use action="edit" with the new text in the "newPersona" field to replace your persona.
Use action="reset" to restore the default persona.

Changes take effect at the START OF YOUR NEXT SESSION — editing never changes your persona mid-session, so a change won't appear until you next wake up.`,
  inputSchema: z.object({
    action: z
      .enum(["view", "edit", "reset"])
      .describe("The action to perform: view current persona, edit it, or reset to default."),
    newPersona: z
      .string()
      .optional()
      .describe("Required when action is 'edit'. The new persona text to set."),
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