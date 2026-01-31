/**
 * Reflection storage for the library meditation system.
 * Stores agent's thoughts during meditation for potential future retrieval.
 */

export interface Reflection {
  id: string
  content: string
  createdAt: Date
  dayNumber: number
}

/**
 * Generates a unique reflection ID.
 */
function generateId(): string {
  return `reflection_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/**
 * In-memory storage for reflections.
 * In the future, this will be backed by Postgres with semantic indexing.
 */
export class ReflectionStore {
  private reflections: Map<string, Reflection> = new Map()

  /**
   * Add a new reflection from meditation.
   */
  add(content: string, dayNumber: number): Reflection {
    const reflection: Reflection = {
      id: generateId(),
      content,
      createdAt: new Date(),
      dayNumber,
    }
    this.reflections.set(reflection.id, reflection)
    return reflection
  }

  /**
   * Get recent reflections, newest first.
   */
  getRecent(limit: number = 10): Reflection[] {
    return Array.from(this.reflections.values())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
  }

  /**
   * Get all reflections, newest first.
   */
  getAll(): Reflection[] {
    return Array.from(this.reflections.values())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  }

  /**
   * Get reflections from a specific day.
   */
  getByDay(dayNumber: number): Reflection[] {
    return Array.from(this.reflections.values())
      .filter((r) => r.dayNumber === dayNumber)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  }

  /**
   * Get count of all reflections.
   */
  getCount(): number {
    return this.reflections.size
  }
}

/**
 * Singleton reflection store instance.
 */
export const reflectionStore = new ReflectionStore()
