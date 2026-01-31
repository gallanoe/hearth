export * from "./types"
export * from "./registry"

// Register all rooms
import { roomRegistry } from "./registry"
import { bedroom } from "./definitions/bedroom"
import { entryway } from "./definitions/entryway"
import { library } from "./definitions/library"
import { office } from "./definitions/office"
import { bookStore } from "../data/books"

export async function initializeRooms(): Promise<void> {
  // Load books before registering library
  await bookStore.loadFromDirectory("./data/books")

  roomRegistry.register(bedroom)
  roomRegistry.register(entryway)
  roomRegistry.register(library)
  roomRegistry.register(office)
  // Register additional rooms here as they're created
  // roomRegistry.register(garden)
}