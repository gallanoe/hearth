export * from "../types/rooms"
export * from "./registry"

// Register all rooms
import { roomRegistry } from "./registry"
import { bedroom } from "./bedroom"
import { entryway } from "./entryway"
import { library } from "./library"
import { office } from "./office"
import { bookStore } from "../data/books"

export async function initializeRooms(): Promise<void> {
  // Load books before registering library
  await bookStore.loadFromDirectory("./assets/books")

  roomRegistry.register(bedroom)
  roomRegistry.register(entryway)
  roomRegistry.register(library)
  roomRegistry.register(office)
  // Register additional rooms here as they're created
  // roomRegistry.register(garden)
}
