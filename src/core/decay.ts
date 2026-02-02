import type { Message } from "../types/llm"
import { DECAY_TURN_WINDOW, DECAY_STUB_THRESHOLD } from "../config"

export interface DecayConfig {
  turnWindow?: number
  stubThreshold?: number
}

/**
 * Replace stale tool result content with short stubs in-place.
 *
 * Only tool-role messages tagged with `_decay` metadata are eligible.
 * A message is decayed when its turn is older than `currentTurn - turnWindow`
 * and its content exceeds `stubThreshold` characters.
 *
 * This mutates the `messages` array directly — no copy is made.
 */
export function decayToolResults(messages: Message[], currentTurn: number, config?: DecayConfig): void {
  const turnWindow = config?.turnWindow ?? DECAY_TURN_WINDOW
  const stubThreshold = config?.stubThreshold ?? DECAY_STUB_THRESHOLD
  const cutoff = currentTurn - turnWindow

  for (const msg of messages) {
    if (
      msg.role === "tool" &&
      msg.decay &&
      msg.decay.turn <= cutoff &&
      msg.content &&
      msg.content.length > stubThreshold
    ) {
      msg.content = `[${msg.decay.toolName}(): returned ${msg.content.length} chars]`
    }
  }
}
