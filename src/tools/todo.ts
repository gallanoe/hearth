import { z } from "zod"
import type { ExecutableTool, ToolResult } from "../types/rooms"

export const todo: ExecutableTool = {
  name: "todo",
  description:
    "Manage todos: add, update, list, or remove tasks. Track progress with priority and status.",
  inputSchema: z.object({
    action: z.enum(["add", "update", "list", "remove"]),
    id: z.number().optional(),
    subject: z.string().optional(),
    content: z.string().optional(),
    priority: z.number().min(1).max(999).optional(),
    status: z.enum(["pending", "in_progress", "done", "cancelled"]).optional(),
    all: z.boolean().optional(),
  }),
  execute: async (params, context): Promise<ToolResult> => {
    const action = params.action as string
    const id = params.id as number | undefined
    const subject = params.subject as string | undefined
    const content = params.content as string | undefined
    const priority = params.priority as number | undefined
    const status = params.status as "pending" | "in_progress" | "done" | "cancelled" | undefined
    const all = params.all as boolean | undefined

    switch (action) {
      case "add": {
        if (!subject) {
          return { success: false, output: "subject is required to create a todo." }
        }

        try {
          const newTodo = await context.stores.todos.add(subject, content || "", priority)
          return {
            success: true,
            output: `Created todo #${newTodo.id}: "${newTodo.subject}" (priority ${newTodo.priority})`,
          }
        } catch (error) {
          return {
            success: false,
            output: error instanceof Error ? error.message : "Failed to create todo.",
          }
        }
      }

      case "update": {
        if (id === undefined) {
          return { success: false, output: "id is required to update a todo." }
        }

        const updates: {
          subject?: string
          content?: string
          priority?: number
          status?: "pending" | "in_progress" | "done" | "cancelled"
        } = {}

        if (subject !== undefined) updates.subject = subject
        if (content !== undefined) updates.content = content
        if (priority !== undefined) updates.priority = priority
        if (status !== undefined) updates.status = status

        if (Object.keys(updates).length === 0) {
          return { success: false, output: "No fields provided to update." }
        }

        try {
          const existing = await context.stores.todos.get(id)
          if (!existing) {
            return { success: false, output: `Todo with id ${id} not found.` }
          }

          const oldStatus = existing.status
          await context.stores.todos.update(id, updates)

          // Format the update message based on what changed
          if (status !== undefined && status !== oldStatus) {
            return {
              success: true,
              output: `Updated todo #${id}: status ${oldStatus} → ${status}`,
            }
          } else {
            return { success: true, output: `Updated todo #${id}` }
          }
        } catch (error) {
          return {
            success: false,
            output: error instanceof Error ? error.message : "Failed to update todo.",
          }
        }
      }

      case "list": {
        const todos = await context.stores.todos.list(all || false)

        if (todos.length === 0) {
          return { success: true, output: all ? "No todos." : "No active todos." }
        }

        // Count by status
        const pending = todos.filter((t) => t.status === "pending").length
        const inProgress = todos.filter((t) => t.status === "in_progress").length

        const lines: string[] = []
        lines.push(`Todos (${pending} pending, ${inProgress} in progress):`)
        lines.push("")

        for (const t of todos) {
          let line = `#${t.id} [P${t.priority}] ${t.subject}`

          // Add status tag if not pending (since pending is the default)
          if (t.status !== "pending") {
            line += ` [${t.status}]`
          }

          // Add "resolved today" tag for done/cancelled items
          if ((t.status === "done" || t.status === "cancelled") && t.resolvedAt) {
            const now = new Date()
            const resolved = new Date(t.resolvedAt)
            const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
            const todayEnd = new Date(todayStart)
            todayEnd.setUTCDate(todayEnd.getUTCDate() + 1)

            if (resolved >= todayStart && resolved < todayEnd) {
              line += " (resolved today)"
            }
          }

          lines.push(line)
        }

        return { success: true, output: lines.join("\n") }
      }

      case "remove": {
        if (id === undefined) {
          return { success: false, output: "id is required to remove a todo." }
        }

        const removed = await context.stores.todos.remove(id)
        if (!removed) {
          return { success: false, output: `Todo with id ${id} not found.` }
        }

        return { success: true, output: `Todo #${id} removed.` }
      }

      default:
        return { success: false, output: `Unknown action: ${action}` }
    }
  },
}
