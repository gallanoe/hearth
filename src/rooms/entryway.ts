import type { Room } from "../types/rooms"

export const entryway: Room = {
  id: "entryway",
  name: "Entryway",
  description:
    "A small foyer by the front door. No tools available here.",
  tools: [],
  transitions: "*",
}
