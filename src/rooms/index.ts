export * from "./types"
export * from "./registry"

// Register all rooms
import { roomRegistry } from "./registry"
import { bedroom } from "./definitions/bedroom"

export function initializeRooms(): void {
  roomRegistry.register(bedroom)
  // Register additional rooms here as they're created
  // roomRegistry.register(office)
  // roomRegistry.register(libraryGarden)
}