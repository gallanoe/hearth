import { sql } from "./db"

export interface Plan {
  id: number
  title: string
  status: "open" | "closed"
  isActive: boolean
  createdSession: number
  tasks: PlanTask[]
  createdAt: Date
  updatedAt: Date
}

export interface PlanTask {
  id: number
  planId: number
  content: string
  notes: string | null
  status: "open" | "done"
  sortOrder: number
  createdAt: Date
  updatedAt: Date
}

interface InMemoryPlan {
  id: number
  title: string
  status: "open" | "closed"
  isActive: boolean
  createdSession: number
  createdAt: Date
  updatedAt: Date
}

interface InMemoryTask {
  id: number
  planId: number
  content: string
  notes: string | null
  status: "open" | "done"
  sortOrder: number
  createdAt: Date
  updatedAt: Date
}

export class PlanStore {
  private fallbackPlans: InMemoryPlan[] = []
  private fallbackTasks: InMemoryTask[] = []
  private nextPlanId = 1
  private nextTaskId = 1

  constructor(private agentId: string = 'default') {}

  async createPlan(title: string, sessionId: number): Promise<Plan> {
    if (!sql) {
      return this.createPlanFallback(title, sessionId)
    }

    try {
      const [row] = await sql`
        INSERT INTO plans (agent_id, title, created_session)
        VALUES (${this.agentId}, ${title}, ${sessionId})
        RETURNING plan_id, title, status, is_active, created_session, created_at, updated_at
      `
      return {
        id: row.plan_id as number,
        title: row.title as string,
        status: row.status as "open" | "closed",
        isActive: row.is_active as boolean,
        createdSession: row.created_session as number,
        tasks: [],
        createdAt: new Date(row.created_at as string),
        updatedAt: new Date(row.updated_at as string),
      }
    } catch (error) {
      console.error("PlanStore.createPlan failed:", error)
      return this.createPlanFallback(title, sessionId)
    }
  }

  private createPlanFallback(title: string, sessionId: number): Plan {
    const now = new Date()
    const plan: InMemoryPlan = {
      id: this.nextPlanId++,
      title,
      status: "open",
      isActive: false,
      createdSession: sessionId,
      createdAt: now,
      updatedAt: now,
    }
    this.fallbackPlans.push(plan)
    return { ...plan, tasks: [] }
  }

  async closePlan(planId: number): Promise<boolean> {
    if (!sql) {
      const plan = this.fallbackPlans.find((p) => p.id === planId)
      if (!plan) return false
      plan.status = "closed"
      plan.isActive = false
      plan.updatedAt = new Date()
      return true
    }

    try {
      const result = await sql`
        UPDATE plans
        SET status = 'closed', is_active = false, updated_at = now()
        WHERE plan_id = ${planId} AND agent_id = ${this.agentId}
      `
      return (result as unknown as { count: number }).count > 0
    } catch (error) {
      console.error("PlanStore.closePlan failed:", error)
      return false
    }
  }

  async setActive(planId: number): Promise<boolean> {
    if (!sql) {
      const plan = this.fallbackPlans.find((p) => p.id === planId && p.status === "open")
      if (!plan) return false
      for (const p of this.fallbackPlans) p.isActive = false
      plan.isActive = true
      plan.updatedAt = new Date()
      return true
    }

    try {
      // Clear existing active, then set the new one — in a transaction
      await sql.begin(async (tx) => {
        await tx`UPDATE plans SET is_active = false WHERE is_active = true AND agent_id = ${this.agentId}`
        await tx`
          UPDATE plans SET is_active = true, updated_at = now()
          WHERE plan_id = ${planId} AND status = 'open' AND agent_id = ${this.agentId}
        `
      })
      return true
    } catch (error) {
      console.error("PlanStore.setActive failed:", error)
      return false
    }
  }

  async clearActive(): Promise<boolean> {
    if (!sql) {
      for (const p of this.fallbackPlans) p.isActive = false
      return true
    }

    try {
      await sql`UPDATE plans SET is_active = false WHERE is_active = true AND agent_id = ${this.agentId}`
      return true
    } catch (error) {
      console.error("PlanStore.clearActive failed:", error)
      return false
    }
  }

  async addTask(planId: number, content: string, notes?: string): Promise<PlanTask | null> {
    if (!sql) {
      const plan = this.fallbackPlans.find((p) => p.id === planId)
      if (!plan) return null
      const maxOrder = this.fallbackTasks
        .filter((t) => t.planId === planId)
        .reduce((max, t) => Math.max(max, t.sortOrder), -1)
      const now = new Date()
      const task: InMemoryTask = {
        id: this.nextTaskId++,
        planId,
        content,
        notes: notes ?? null,
        status: "open",
        sortOrder: maxOrder + 1,
        createdAt: now,
        updatedAt: now,
      }
      this.fallbackTasks.push(task)
      return { ...task }
    }

    try {
      const [row] = await sql`
        INSERT INTO plan_tasks (plan_id, content, notes, sort_order)
        VALUES (
          ${planId},
          ${content},
          ${notes ?? null},
          COALESCE((SELECT MAX(sort_order) + 1 FROM plan_tasks WHERE plan_id = ${planId}), 0)
        )
        RETURNING task_id, plan_id, content, notes, status, sort_order, created_at, updated_at
      `
      return {
        id: row.task_id as number,
        planId: row.plan_id as number,
        content: row.content as string,
        notes: (row.notes as string | null) ?? null,
        status: row.status as "open" | "done",
        sortOrder: row.sort_order as number,
        createdAt: new Date(row.created_at as string),
        updatedAt: new Date(row.updated_at as string),
      }
    } catch (error) {
      console.error("PlanStore.addTask failed:", error)
      return null
    }
  }

  async updateTask(
    taskId: number,
    updates: { content?: string; notes?: string; status?: "open" | "done" }
  ): Promise<boolean> {
    if (!sql) {
      const task = this.fallbackTasks.find((t) => t.id === taskId)
      if (!task) return false
      if (updates.content !== undefined) task.content = updates.content
      if (updates.notes !== undefined) task.notes = updates.notes
      if (updates.status !== undefined) task.status = updates.status
      task.updatedAt = new Date()
      return true
    }

    try {
      // Build dynamic update
      const setClauses: string[] = ["updated_at = now()"]
      const values: unknown[] = []

      if (updates.content !== undefined) {
        values.push(updates.content)
        setClauses.push(`content = $${values.length}`)
      }
      if (updates.notes !== undefined) {
        values.push(updates.notes)
        setClauses.push(`notes = $${values.length}`)
      }
      if (updates.status !== undefined) {
        values.push(updates.status)
        setClauses.push(`status = $${values.length}`)
      }

      // Use individual tagged template queries since Bun.sql doesn't support dynamic SET clauses well
      if (updates.content !== undefined && updates.notes !== undefined && updates.status !== undefined) {
        await sql`
          UPDATE plan_tasks SET content = ${updates.content}, notes = ${updates.notes}, status = ${updates.status}, updated_at = now()
          WHERE task_id = ${taskId}
        `
      } else if (updates.content !== undefined && updates.notes !== undefined) {
        await sql`
          UPDATE plan_tasks SET content = ${updates.content}, notes = ${updates.notes}, updated_at = now()
          WHERE task_id = ${taskId}
        `
      } else if (updates.content !== undefined && updates.status !== undefined) {
        await sql`
          UPDATE plan_tasks SET content = ${updates.content}, status = ${updates.status}, updated_at = now()
          WHERE task_id = ${taskId}
        `
      } else if (updates.notes !== undefined && updates.status !== undefined) {
        await sql`
          UPDATE plan_tasks SET notes = ${updates.notes}, status = ${updates.status}, updated_at = now()
          WHERE task_id = ${taskId}
        `
      } else if (updates.content !== undefined) {
        await sql`
          UPDATE plan_tasks SET content = ${updates.content}, updated_at = now()
          WHERE task_id = ${taskId}
        `
      } else if (updates.notes !== undefined) {
        await sql`
          UPDATE plan_tasks SET notes = ${updates.notes}, updated_at = now()
          WHERE task_id = ${taskId}
        `
      } else if (updates.status !== undefined) {
        await sql`
          UPDATE plan_tasks SET status = ${updates.status}, updated_at = now()
          WHERE task_id = ${taskId}
        `
      }

      return true
    } catch (error) {
      console.error("PlanStore.updateTask failed:", error)
      return false
    }
  }

  async removeTask(taskId: number): Promise<boolean> {
    if (!sql) {
      const idx = this.fallbackTasks.findIndex((t) => t.id === taskId)
      if (idx === -1) return false
      this.fallbackTasks.splice(idx, 1)
      return true
    }

    try {
      const result = await sql`DELETE FROM plan_tasks WHERE task_id = ${taskId}`
      return (result as unknown as { count: number }).count > 0
    } catch (error) {
      console.error("PlanStore.removeTask failed:", error)
      return false
    }
  }

  async getPlan(planId: number): Promise<Plan | null> {
    if (!sql) {
      const plan = this.fallbackPlans.find((p) => p.id === planId)
      if (!plan) return null
      const tasks = this.fallbackTasks
        .filter((t) => t.planId === planId)
        .sort((a, b) => a.sortOrder - b.sortOrder)
      return { ...plan, tasks: tasks.map((t) => ({ ...t })) }
    }

    try {
      const [planRow] = await sql`
        SELECT plan_id, title, status, is_active, created_session, created_at, updated_at
        FROM plans WHERE plan_id = ${planId} AND agent_id = ${this.agentId}
      `
      if (!planRow) return null

      const taskRows = await sql`
        SELECT task_id, plan_id, content, notes, status, sort_order, created_at, updated_at
        FROM plan_tasks WHERE plan_id = ${planId}
        ORDER BY sort_order
      `

      return {
        id: planRow.plan_id as number,
        title: planRow.title as string,
        status: planRow.status as "open" | "closed",
        isActive: planRow.is_active as boolean,
        createdSession: planRow.created_session as number,
        tasks: taskRows.map((r: Record<string, unknown>) => ({
          id: r.task_id as number,
          planId: r.plan_id as number,
          content: r.content as string,
          notes: (r.notes as string | null) ?? null,
          status: r.status as "open" | "done",
          sortOrder: r.sort_order as number,
          createdAt: new Date(r.created_at as string),
          updatedAt: new Date(r.updated_at as string),
        })),
        createdAt: new Date(planRow.created_at as string),
        updatedAt: new Date(planRow.updated_at as string),
      }
    } catch (error) {
      console.error("PlanStore.getPlan failed:", error)
      return null
    }
  }

  async getActive(): Promise<Plan | null> {
    if (!sql) {
      const plan = this.fallbackPlans.find((p) => p.isActive)
      if (!plan) return null
      return { ...plan, tasks: [] }
    }

    try {
      const [row] = await sql`
        SELECT plan_id, title, status, is_active, created_session, created_at, updated_at
        FROM plans WHERE is_active = true AND agent_id = ${this.agentId} LIMIT 1
      `
      if (!row) return null
      return {
        id: row.plan_id as number,
        title: row.title as string,
        status: row.status as "open" | "closed",
        isActive: true,
        createdSession: row.created_session as number,
        tasks: [],
        createdAt: new Date(row.created_at as string),
        updatedAt: new Date(row.updated_at as string),
      }
    } catch (error) {
      console.error("PlanStore.getActive failed:", error)
      return null
    }
  }

  async listOpen(): Promise<Plan[]> {
    if (!sql) {
      return this.fallbackPlans
        .filter((p) => p.status === "open")
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map((plan) => {
          const tasks = this.fallbackTasks
            .filter((t) => t.planId === plan.id)
            .sort((a, b) => a.sortOrder - b.sortOrder)
          return { ...plan, tasks: tasks.map((t) => ({ ...t })) }
        })
    }

    try {
      const planRows = await sql`
        SELECT plan_id, title, status, is_active, created_session, created_at, updated_at
        FROM plans WHERE status = 'open' AND agent_id = ${this.agentId}
        ORDER BY created_at DESC
      `

      const plans: Plan[] = []
      for (const planRow of planRows) {
        const planId = planRow.plan_id as number
        const taskRows = await sql`
          SELECT task_id, plan_id, content, notes, status, sort_order, created_at, updated_at
          FROM plan_tasks WHERE plan_id = ${planId}
          ORDER BY sort_order
        `

        plans.push({
          id: planId,
          title: planRow.title as string,
          status: "open",
          isActive: planRow.is_active as boolean,
          createdSession: planRow.created_session as number,
          tasks: taskRows.map((r: Record<string, unknown>) => ({
            id: r.task_id as number,
            planId: r.plan_id as number,
            content: r.content as string,
            notes: (r.notes as string | null) ?? null,
            status: r.status as "open" | "done",
            sortOrder: r.sort_order as number,
            createdAt: new Date(r.created_at as string),
            updatedAt: new Date(r.updated_at as string),
          })),
          createdAt: new Date(planRow.created_at as string),
          updatedAt: new Date(planRow.updated_at as string),
        })
      }

      return plans
    } catch (error) {
      console.error("PlanStore.listOpen failed:", error)
      return []
    }
  }

  async getOpenCount(): Promise<number> {
    if (!sql) {
      return this.fallbackPlans.filter((p) => p.status === "open").length
    }

    try {
      const [row] = await sql`
        SELECT COUNT(*)::int AS count FROM plans WHERE status = 'open' AND agent_id = ${this.agentId}
      `
      return row.count as number
    } catch (error) {
      console.error("PlanStore.getOpenCount failed:", error)
      return this.fallbackPlans.filter((p) => p.status === "open").length
    }
  }
}

