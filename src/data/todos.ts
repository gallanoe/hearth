import { sql } from "./db"

export type TodoStatus = "pending" | "in_progress" | "done" | "cancelled"

export interface Todo {
  id: number
  agentId: string
  subject: string
  content: string
  priority: number
  status: TodoStatus
  resolvedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

const VALID_TRANSITIONS: Record<TodoStatus, TodoStatus[]> = {
  pending: ["in_progress", "done", "cancelled"],
  in_progress: ["pending", "done", "cancelled"],
  done: [],
  cancelled: [],
}

interface InMemoryTodo {
  id: number
  agentId: string
  subject: string
  content: string
  priority: number
  status: TodoStatus
  resolvedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export class TodoStore {
  private fallbackTodos: InMemoryTodo[] = []
  private nextId = 1

  constructor(
    private db: typeof sql | null,
    private agentId: string
  ) {}

  private validateTransition(from: TodoStatus, to: TodoStatus): void {
    const validNextStates = VALID_TRANSITIONS[from]
    if (!validNextStates.includes(to)) {
      throw new Error(`Invalid status transition from '${from}' to '${to}'`)
    }
  }

  private isResolvedToday(todo: Todo): boolean {
    if (!todo.resolvedAt) return false
    const now = new Date()
    const resolved = new Date(todo.resolvedAt)
    // Check if resolved date is today (UTC)
    const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    const todayEnd = new Date(todayStart)
    todayEnd.setUTCDate(todayEnd.getUTCDate() + 1)
    return resolved >= todayStart && resolved < todayEnd
  }

  async add(subject: string, content: string = "", priority: number = 999): Promise<Todo> {
    if (priority < 1 || priority > 999) {
      throw new Error("Priority must be between 1 and 999")
    }

    if (!this.db) {
      return this.addFallback(subject, content, priority)
    }

    try {
      const [row] = await this.db`
        INSERT INTO todos (agent_id, subject, content, priority)
        VALUES (${this.agentId}, ${subject}, ${content}, ${priority})
        RETURNING todo_id, agent_id, subject, content, priority, status, resolved_at, created_at, updated_at
      ` as any

      return {
        id: row.todo_id as number,
        agentId: row.agent_id as string,
        subject: row.subject as string,
        content: row.content as string,
        priority: row.priority as number,
        status: row.status as TodoStatus,
        resolvedAt: row.resolved_at ? new Date(row.resolved_at as string) : null,
        createdAt: new Date(row.created_at as string),
        updatedAt: new Date(row.updated_at as string),
      }
    } catch (error) {
      console.error("TodoStore.add failed:", error)
      return this.addFallback(subject, content, priority)
    }
  }

  private addFallback(subject: string, content: string, priority: number): Todo {
    const now = new Date()
    const todo: InMemoryTodo = {
      id: this.nextId++,
      agentId: this.agentId,
      subject,
      content,
      priority,
      status: "pending",
      resolvedAt: null,
      createdAt: now,
      updatedAt: now,
    }
    this.fallbackTodos.push(todo)
    return { ...todo }
  }

  async update(
    id: number,
    updates: Partial<Pick<Todo, "subject" | "content" | "priority" | "status">>
  ): Promise<Todo> {
    if (updates.priority !== undefined && (updates.priority < 1 || updates.priority > 999)) {
      throw new Error("Priority must be between 1 and 999")
    }

    if (!this.db) {
      return this.updateFallback(id, updates)
    }

    try {
      // Get current todo to validate transition
      const todo = await this.get(id)
      if (!todo) {
        throw new Error(`Todo with id ${id} not found`)
      }

      // Validate status transition if status is being updated
      if (updates.status !== undefined && updates.status !== todo.status) {
        this.validateTransition(todo.status, updates.status)
      }

      // Determine if we need to set resolvedAt
      const isBecomingResolved =
        updates.status !== undefined &&
        (updates.status === "done" || updates.status === "cancelled") &&
        todo.status !== "done" &&
        todo.status !== "cancelled"

      const resolvedAt = isBecomingResolved ? new Date() : undefined

      // Build the update query based on what fields are present
      let result: any
      const now = new Date()

      if (updates.subject !== undefined && updates.content !== undefined && updates.priority !== undefined && updates.status !== undefined) {
        [result] = await this.db`
          UPDATE todos
          SET subject = ${updates.subject}, content = ${updates.content}, priority = ${updates.priority},
              status = ${updates.status}, resolved_at = ${resolvedAt ?? null}, updated_at = ${now}
          WHERE todo_id = ${id} AND agent_id = ${this.agentId}
          RETURNING todo_id, agent_id, subject, content, priority, status, resolved_at, created_at, updated_at
        ` as any
      } else if (updates.subject !== undefined && updates.content !== undefined && updates.priority !== undefined) {
        [result] = await this.db`
          UPDATE todos
          SET subject = ${updates.subject}, content = ${updates.content}, priority = ${updates.priority}, updated_at = ${now}
          WHERE todo_id = ${id} AND agent_id = ${this.agentId}
          RETURNING todo_id, agent_id, subject, content, priority, status, resolved_at, created_at, updated_at
        ` as any
      } else if (updates.subject !== undefined && updates.content !== undefined && updates.status !== undefined) {
        [result] = await this.db`
          UPDATE todos
          SET subject = ${updates.subject}, content = ${updates.content}, status = ${updates.status},
              resolved_at = ${resolvedAt ?? null}, updated_at = ${now}
          WHERE todo_id = ${id} AND agent_id = ${this.agentId}
          RETURNING todo_id, agent_id, subject, content, priority, status, resolved_at, created_at, updated_at
        ` as any
      } else if (updates.subject !== undefined && updates.priority !== undefined && updates.status !== undefined) {
        [result] = await this.db`
          UPDATE todos
          SET subject = ${updates.subject}, priority = ${updates.priority}, status = ${updates.status},
              resolved_at = ${resolvedAt ?? null}, updated_at = ${now}
          WHERE todo_id = ${id} AND agent_id = ${this.agentId}
          RETURNING todo_id, agent_id, subject, content, priority, status, resolved_at, created_at, updated_at
        ` as any
      } else if (updates.content !== undefined && updates.priority !== undefined && updates.status !== undefined) {
        [result] = await this.db`
          UPDATE todos
          SET content = ${updates.content}, priority = ${updates.priority}, status = ${updates.status},
              resolved_at = ${resolvedAt ?? null}, updated_at = ${now}
          WHERE todo_id = ${id} AND agent_id = ${this.agentId}
          RETURNING todo_id, agent_id, subject, content, priority, status, resolved_at, created_at, updated_at
        ` as any
      } else if (updates.subject !== undefined && updates.content !== undefined) {
        [result] = await this.db`
          UPDATE todos
          SET subject = ${updates.subject}, content = ${updates.content}, updated_at = ${now}
          WHERE todo_id = ${id} AND agent_id = ${this.agentId}
          RETURNING todo_id, agent_id, subject, content, priority, status, resolved_at, created_at, updated_at
        ` as any
      } else if (updates.subject !== undefined && updates.priority !== undefined) {
        [result] = await this.db`
          UPDATE todos
          SET subject = ${updates.subject}, priority = ${updates.priority}, updated_at = ${now}
          WHERE todo_id = ${id} AND agent_id = ${this.agentId}
          RETURNING todo_id, agent_id, subject, content, priority, status, resolved_at, created_at, updated_at
        ` as any
      } else if (updates.subject !== undefined && updates.status !== undefined) {
        [result] = await this.db`
          UPDATE todos
          SET subject = ${updates.subject}, status = ${updates.status}, resolved_at = ${resolvedAt ?? null}, updated_at = ${now}
          WHERE todo_id = ${id} AND agent_id = ${this.agentId}
          RETURNING todo_id, agent_id, subject, content, priority, status, resolved_at, created_at, updated_at
        ` as any
      } else if (updates.content !== undefined && updates.priority !== undefined) {
        [result] = await this.db`
          UPDATE todos
          SET content = ${updates.content}, priority = ${updates.priority}, updated_at = ${now}
          WHERE todo_id = ${id} AND agent_id = ${this.agentId}
          RETURNING todo_id, agent_id, subject, content, priority, status, resolved_at, created_at, updated_at
        ` as any
      } else if (updates.content !== undefined && updates.status !== undefined) {
        [result] = await this.db`
          UPDATE todos
          SET content = ${updates.content}, status = ${updates.status}, resolved_at = ${resolvedAt ?? null}, updated_at = ${now}
          WHERE todo_id = ${id} AND agent_id = ${this.agentId}
          RETURNING todo_id, agent_id, subject, content, priority, status, resolved_at, created_at, updated_at
        ` as any
      } else if (updates.priority !== undefined && updates.status !== undefined) {
        [result] = await this.db`
          UPDATE todos
          SET priority = ${updates.priority}, status = ${updates.status}, resolved_at = ${resolvedAt ?? null}, updated_at = ${now}
          WHERE todo_id = ${id} AND agent_id = ${this.agentId}
          RETURNING todo_id, agent_id, subject, content, priority, status, resolved_at, created_at, updated_at
        ` as any
      } else if (updates.subject !== undefined) {
        [result] = await this.db`
          UPDATE todos
          SET subject = ${updates.subject}, updated_at = ${now}
          WHERE todo_id = ${id} AND agent_id = ${this.agentId}
          RETURNING todo_id, agent_id, subject, content, priority, status, resolved_at, created_at, updated_at
        ` as any
      } else if (updates.content !== undefined) {
        [result] = await this.db`
          UPDATE todos
          SET content = ${updates.content}, updated_at = ${now}
          WHERE todo_id = ${id} AND agent_id = ${this.agentId}
          RETURNING todo_id, agent_id, subject, content, priority, status, resolved_at, created_at, updated_at
        ` as any
      } else if (updates.priority !== undefined) {
        [result] = await this.db`
          UPDATE todos
          SET priority = ${updates.priority}, updated_at = ${now}
          WHERE todo_id = ${id} AND agent_id = ${this.agentId}
          RETURNING todo_id, agent_id, subject, content, priority, status, resolved_at, created_at, updated_at
        ` as any
      } else if (updates.status !== undefined) {
        [result] = await this.db`
          UPDATE todos
          SET status = ${updates.status}, resolved_at = ${resolvedAt ?? null}, updated_at = ${now}
          WHERE todo_id = ${id} AND agent_id = ${this.agentId}
          RETURNING todo_id, agent_id, subject, content, priority, status, resolved_at, created_at, updated_at
        ` as any
      } else {
        throw new Error("No valid updates provided")
      }

      if (!result) {
        throw new Error(`Todo with id ${id} not found`)
      }

      return {
        id: result.todo_id as number,
        agentId: result.agent_id as string,
        subject: result.subject as string,
        content: result.content as string,
        priority: result.priority as number,
        status: result.status as TodoStatus,
        resolvedAt: result.resolved_at ? new Date(result.resolved_at as string) : null,
        createdAt: new Date(result.created_at as string),
        updatedAt: new Date(result.updated_at as string),
      }
    } catch (error) {
      console.error("TodoStore.update failed:", error)
      return this.updateFallback(id, updates)
    }
  }

  private updateFallback(
    id: number,
    updates: Partial<Pick<Todo, "subject" | "content" | "priority" | "status">>
  ): Todo {
    const todo = this.fallbackTodos.find((t) => t.id === id && t.agentId === this.agentId)
    if (!todo) {
      throw new Error(`Todo with id ${id} not found`)
    }

    // Validate status transition if status is being updated
    if (updates.status !== undefined && updates.status !== todo.status) {
      this.validateTransition(todo.status, updates.status)
    }

    if (updates.subject !== undefined) todo.subject = updates.subject
    if (updates.content !== undefined) todo.content = updates.content
    if (updates.priority !== undefined) todo.priority = updates.priority
    if (updates.status !== undefined) {
      const wasResolved = todo.status === "done" || todo.status === "cancelled"
      const isBecomingResolved = updates.status === "done" || updates.status === "cancelled"
      todo.status = updates.status
      if (!wasResolved && isBecomingResolved) {
        todo.resolvedAt = new Date()
      }
    }
    todo.updatedAt = new Date()

    return { ...todo }
  }

  async remove(id: number): Promise<boolean> {
    if (!this.db) {
      const index = this.fallbackTodos.findIndex((t) => t.id === id && t.agentId === this.agentId)
      if (index === -1) return false
      this.fallbackTodos.splice(index, 1)
      return true
    }

    try {
      const result = await this.db`
        DELETE FROM todos WHERE todo_id = ${id} AND agent_id = ${this.agentId}
      ` as any
      return (result as unknown as { count: number }).count > 0
    } catch (error) {
      console.error("TodoStore.remove failed:", error)
      return false
    }
  }

  async get(id: number): Promise<Todo | null> {
    if (!this.db) {
      const todo = this.fallbackTodos.find((t) => t.id === id && t.agentId === this.agentId)
      return todo ? { ...todo } : null
    }

    try {
      const [row] = await this.db`
        SELECT todo_id, agent_id, subject, content, priority, status, resolved_at, created_at, updated_at
        FROM todos WHERE todo_id = ${id} AND agent_id = ${this.agentId}
      ` as any

      if (!row) return null

      return {
        id: row.todo_id as number,
        agentId: row.agent_id as string,
        subject: row.subject as string,
        content: row.content as string,
        priority: row.priority as number,
        status: row.status as TodoStatus,
        resolvedAt: row.resolved_at ? new Date(row.resolved_at as string) : null,
        createdAt: new Date(row.created_at as string),
        updatedAt: new Date(row.updated_at as string),
      }
    } catch (error) {
      console.error("TodoStore.get failed:", error)
      return null
    }
  }

  async list(includeAll: boolean = false): Promise<Todo[]> {
    if (!this.db) {
      return this.listFallback(includeAll)
    }

    try {
      let rows: any[]
      if (includeAll) {
        rows = await this.db`
          SELECT todo_id, agent_id, subject, content, priority, status, resolved_at, created_at, updated_at
          FROM todos WHERE agent_id = ${this.agentId}
          ORDER BY priority ASC, created_at ASC
        ` as any
      } else {
        // Active + today's resolved
        const todayStart = new Date()
        todayStart.setUTCHours(0, 0, 0, 0)

        rows = await this.db`
          SELECT todo_id, agent_id, subject, content, priority, status, resolved_at, created_at, updated_at
          FROM todos
          WHERE agent_id = ${this.agentId}
            AND (
              status IN ('pending', 'in_progress')
              OR (status IN ('done', 'cancelled') AND resolved_at >= ${todayStart})
            )
          ORDER BY priority ASC, created_at ASC
        ` as any
      }

      return rows.map((row: any) => ({
        id: row.todo_id as number,
        agentId: row.agent_id as string,
        subject: row.subject as string,
        content: row.content as string,
        priority: row.priority as number,
        status: row.status as TodoStatus,
        resolvedAt: row.resolved_at ? new Date(row.resolved_at as string) : null,
        createdAt: new Date(row.created_at as string),
        updatedAt: new Date(row.updated_at as string),
      }))
    } catch (error) {
      console.error("TodoStore.list failed:", error)
      return this.listFallback(includeAll)
    }
  }

  private listFallback(includeAll: boolean): Todo[] {
    let todos = this.fallbackTodos.filter((t) => t.agentId === this.agentId)

    if (!includeAll) {
      todos = todos.filter((t) => {
        const isActive = t.status === "pending" || t.status === "in_progress"
        const isResolvedToday = this.isResolvedToday(t)
        return isActive || isResolvedToday
      })
    }

    return todos
      .sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority
        return a.createdAt.getTime() - b.createdAt.getTime()
      })
      .map((t) => ({ ...t }))
  }

  async getPendingCount(): Promise<number> {
    if (!this.db) {
      return this.fallbackTodos.filter((t) => t.agentId === this.agentId && t.status === "pending").length
    }

    try {
      const [row] = await this.db`
        SELECT COUNT(*)::int AS count FROM todos
        WHERE agent_id = ${this.agentId} AND status = 'pending'
      ` as any
      return row.count as number
    } catch (error) {
      console.error("TodoStore.getPendingCount failed:", error)
      return this.fallbackTodos.filter((t) => t.agentId === this.agentId && t.status === "pending").length
    }
  }
}
