export * from "./types"
export * from "./registry"

// Register all rooms
import { roomRegistry } from "./registry"
import { bedroom } from "./definitions/bedroom"
import { entryway } from "./definitions/entryway"

export function initializeRooms(): void {
  roomRegistry.register(bedroom)
  roomRegistry.register(entryway)
  // Register additional rooms here as they're created
  // roomRegistry.register(office)
  // roomRegistry.register(libraryGarden)
}