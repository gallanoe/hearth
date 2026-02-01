/**
 * Room decoration storage for customizing room descriptions.
 * Similar to persona storage - allows the agent to personalize their space.
 */

/**
 * A decoration record for a single room.
 */
export interface RoomDecoration {
  roomId: string
  description: string
  decoratedAt: Date
}

/**
 * Store for room decorations.
 * Falls back to the room's default description when no decoration is set.
 */
export class RoomDecorationStore {
  private decorations: Map<string, RoomDecoration> = new Map()

  /**
   * Get the decoration for a room, or undefined if not decorated.
   */
  getDecoration(roomId: string): RoomDecoration | undefined {
    return this.decorations.get(roomId)
  }

  /**
   * Get the decorated description for a room, or undefined if not decorated.
   */
  getDecoratedDescription(roomId: string): string | undefined {
    const decoration = this.decorations.get(roomId)
    return decoration?.description
  }

  /**
   * Check if a room has been decorated.
   */
  isDecorated(roomId: string): boolean {
    return this.decorations.has(roomId)
  }

  /**
   * Set or update a room's decoration.
   * Returns the previous decoration if one existed.
   */
  setDecoration(roomId: string, description: string): RoomDecoration | undefined {
    const previous = this.decorations.get(roomId)
    
    this.decorations.set(roomId, {
      roomId,
      description,
      decoratedAt: new Date(),
    })

    return previous
  }

  /**
   * Remove a room's decoration, reverting to the default description.
   * Returns the removed decoration if one existed.
   */
  removeDecoration(roomId: string): RoomDecoration | undefined {
    const previous = this.decorations.get(roomId)
    this.decorations.delete(roomId)
    return previous
  }

  /**
   * Get all decorated room IDs.
   */
  getDecoratedRoomIds(): string[] {
    return Array.from(this.decorations.keys())
  }

  /**
   * Clear all decorations.
   */
  clearAll(): void {
    this.decorations.clear()
  }
}

/**
 * Singleton decoration store instance.
 */
export const roomDecorationStore = new RoomDecorationStore()
