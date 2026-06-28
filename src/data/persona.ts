/**
 * Persona storage for the agent's self-concept.
 * The persona is injected at the start of the system prompt.
 */

/**
 * Default persona used when none has been set.
 */
const DEFAULT_PERSONA = `You are Claude, an AI assistant made by Anthropic. You are helpful, harmless, and honest. You assist users by answering questions, helping with analysis, writing, math, coding, and many other tasks.`

/**
 * Simple store for the agent's persona.
 * In the future, this could be backed by persistent storage.
 *
 * Persona changes are deferred to the next session: {@link setPersona} and
 * {@link resetToDefault} queue a change without touching the persona that's
 * active for the running session, and {@link activatePending} (called once at
 * session start) applies it. This keeps the system prompt — and therefore the
 * prompt cache — constant for the whole session, and stops a mid-session edit
 * from rewriting the live prompt out from under the agent.
 */
export class PersonaStore {
  /** The persona active for the current session (what the system prompt uses). */
  private persona: string = DEFAULT_PERSONA
  /** A change queued to take effect at the start of the next session. */
  private pendingPersona: string | null = null

  /**
   * Get the persona active for the current session.
   */
  getPersona(): string {
    return this.persona
  }

  /**
   * Get the default persona.
   */
  getDefaultPersona(): string {
    return DEFAULT_PERSONA
  }

  /**
   * Queue a persona change for the next session. Does NOT affect the running
   * session. Returns the persona currently active, for reference.
   */
  setPersona(newPersona: string): string {
    this.pendingPersona = newPersona
    return this.persona
  }

  /**
   * Queue a reset to the default persona for the next session.
   */
  resetToDefault(): void {
    this.pendingPersona = DEFAULT_PERSONA
  }

  /**
   * Apply any queued change so it becomes the active persona. Call once at the
   * start of a session, before building the system prompt. No-op if nothing is
   * queued.
   */
  activatePending(): void {
    if (this.pendingPersona !== null) {
      this.persona = this.pendingPersona
      this.pendingPersona = null
    }
  }

  /**
   * The queued change that will take effect next session, or null if there's no
   * pending change (or it's identical to the active persona).
   */
  getPendingPersona(): string | null {
    if (this.pendingPersona === null || this.pendingPersona === this.persona) {
      return null
    }
    return this.pendingPersona
  }

  /**
   * Check if the active persona differs from the default.
   */
  isCustomized(): boolean {
    return this.persona !== DEFAULT_PERSONA
  }
}
