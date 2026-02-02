import { z } from "zod"
import type { ExecutableTool, ToolResult } from "../types/rooms"
import { planStore } from "../data/plans"
import { formatRelativeTime } from "../data/letters"

export const plans: ExecutableTool = {
  name: "plans",
  description:
    "Create, view, and update plans. Plans contain tasks. Both persist across sessions.",
  inputSchema: z.object({
    action: z.enum([
      "create",
      "view",
      "list",
      "close",
      "set_active",
      "clear_active",
      "add_task",
      "update_task",
      "remove_task",
    ]),
    planId: z.number().optional(),
    taskId: z.number().optional(),
    title: z.string().optional(),
    content: z.string().optional(),
    notes: z.string().optional(),
    status: z.enum(["open", "done"]).optional(),
  }),
  execute: async (params, context): Promise<ToolResult> => {
    const action = params.action as string
    const planId = params.planId as number | undefined
    const taskId = params.taskId as number | undefined
    const title = params.title as string | undefined
    const content = params.content as string | undefined
    const notes = params.notes as string | undefined
    const status = params.status as "open" | "done" | undefined

    switch (action) {
      case "create": {
        if (!title) {
          return { success: false, output: "Title is required to create a plan." }
        }
        const plan = await planStore.createPlan(title, context.currentSession)
        return {
          success: true,
          output: `Created plan #${plan.id}: ${plan.title}`,
        }
      }

      case "view": {
        if (!planId) {
          return { success: false, output: "planId is required to view a plan." }
        }
        const plan = await planStore.getPlan(planId)
        if (!plan) {
          return { success: false, output: `No plan found with ID ${planId}.` }
        }

        const lines: string[] = []
        const activeTag = plan.isActive ? " [active]" : ""
        lines.push(`Plan #${plan.id}: ${plan.title} (${plan.status})${activeTag}`)
        lines.push(`Created: ${formatRelativeTime(plan.createdAt)}`)

        if (plan.tasks.length === 0) {
          lines.push("")
          lines.push("No tasks.")
        } else {
          lines.push("")
          lines.push("Tasks:")
          for (let i = 0; i < plan.tasks.length; i++) {
            const task = plan.tasks[i]
            lines.push(`${i + 1}. [${task.status}] ${task.content} (#${task.id})`)
            if (task.notes) {
              lines.push(`   Notes: ${task.notes}`)
            }
          }
        }

        return { success: true, output: lines.join("\n") }
      }

      case "list": {
        const openPlans = await planStore.listOpen()
        if (openPlans.length === 0) {
          return { success: true, output: "No open plans." }
        }

        const lines: string[] = ["Open plans:", ""]
        for (const plan of openPlans) {
          const activeTag = plan.isActive ? " [active]" : ""
          lines.push(`Plan #${plan.id}: ${plan.title}${activeTag}`)
          if (plan.tasks.length === 0) {
            lines.push("  (no tasks)")
          } else {
            for (const task of plan.tasks) {
              lines.push(`  - [${task.status}] ${task.content} (#${task.id})`)
            }
          }
          lines.push("")
        }

        return { success: true, output: lines.join("\n").trimEnd() }
      }

      case "close": {
        if (!planId) {
          return { success: false, output: "planId is required to close a plan." }
        }
        const closed = await planStore.closePlan(planId)
        if (!closed) {
          return { success: false, output: `No plan found with ID ${planId}.` }
        }
        return { success: true, output: `Plan #${planId} closed.` }
      }

      case "set_active": {
        if (!planId) {
          return { success: false, output: "planId is required to set a plan as active." }
        }
        const activated = await planStore.setActive(planId)
        if (!activated) {
          return { success: false, output: `No open plan found with ID ${planId}.` }
        }
        return { success: true, output: `Plan #${planId} is now the active plan.` }
      }

      case "clear_active": {
        await planStore.clearActive()
        return { success: true, output: "Active plan cleared." }
      }

      case "add_task": {
        if (!planId) {
          return { success: false, output: "planId is required to add a task." }
        }
        if (!content) {
          return { success: false, output: "content is required to add a task." }
        }
        const task = await planStore.addTask(planId, content, notes)
        if (!task) {
          return { success: false, output: `No plan found with ID ${planId}.` }
        }
        return {
          success: true,
          output: `Added task #${task.id} to plan #${planId}.`,
        }
      }

      case "update_task": {
        if (!taskId) {
          return { success: false, output: "taskId is required to update a task." }
        }
        const updates: { content?: string; notes?: string; status?: "open" | "done" } = {}
        if (content !== undefined) updates.content = content
        if (notes !== undefined) updates.notes = notes
        if (status !== undefined) updates.status = status

        if (Object.keys(updates).length === 0) {
          return { success: false, output: "No fields provided to update." }
        }

        const updated = await planStore.updateTask(taskId, updates)
        if (!updated) {
          return { success: false, output: `No task found with ID ${taskId}.` }
        }
        return { success: true, output: `Task #${taskId} updated.` }
      }

      case "remove_task": {
        if (!taskId) {
          return { success: false, output: "taskId is required to remove a task." }
        }
        const removed = await planStore.removeTask(taskId)
        if (!removed) {
          return { success: false, output: `No task found with ID ${taskId}.` }
        }
        return { success: true, output: `Task #${taskId} removed.` }
      }

      default:
        return { success: false, output: `Unknown action: ${action}` }
    }
  },
}
