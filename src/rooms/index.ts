export * from "../types/rooms"
export * from "./registry"

// Room definitions
import { bedroom } from "./bedroom"
import { entryway } from "./entryway"
import { library } from "./library"
import { office } from "./office"
import type { RoomRegistry } from "./registry"
import type { BookStore } from "../data/books"

export async function initializeRooms(registry: RoomRegistry, books: BookStore): Promise<void> {
  // Load books before registering library
  await books.loadFromDirectory("./assets/books")

  registry.register(bedroom)
  registry.register(entryway)
  registry.register(library)
  registry.register(office)
}
