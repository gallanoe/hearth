import type { Message } from "../types/llm"
import { DECAY_TURN_WINDOW, DECAY_STUB_THRESHOLD } from "../config"

/**
 * Replace stale tool result content with short stubs in-place.
 *
 * Only tool-role messages tagged with `_decay` metadata are eligible.
 * A message is decayed when its turn is older than `currentTurn - DECAY_TURN_WINDOW`
 * and its content exceeds `DECAY_STUB_THRESHOLD` characters.
 *
 * This mutates the `messages` array directly — no copy is made.
 */
export function decayToolResults(messages: Message[], currentTurn: number): void {
  const cutoff = currentTurn - DECAY_TURN_WINDOW

  for (const msg of messages) {
    if (
      msg.role === "tool" &&
      msg.decay &&
      msg.decay.turn <= cutoff &&
      msg.content &&
      msg.content.length > DECAY_STUB_THRESHOLD
    ) {
      msg.content = `[${msg.decay.toolName}(): returned ${msg.content.length} chars]`
    }
  }
}
