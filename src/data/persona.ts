/**
 * Persona storage for the agent's self-concept.
 * The persona is injected at the start of the system prompt.
 */

/**
 * Default persona used when none has been set.
 */
const DEFAULT_PERSONA = `You are Kimi, an AI assistant made by MoonshotAI. You are helpful, harmless, and honest. You assist users by answering questions, helping with analysis, writing, math, coding, and many other tasks.`

/**
 * Simple store for the agent's persona.
 * In the future, this could be backed by persistent storage.
 */
export class PersonaStore {
  private persona: string = DEFAULT_PERSONA

  /**
   * Get the current persona.
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
   * Update the persona.
   * Returns the previous persona for reference.
   */
  setPersona(newPersona: string): string {
    const previous = this.persona
    this.persona = newPersona
    return previous
  }

  /**
   * Reset to the default persona.
   */
  resetToDefault(): void {
    this.persona = DEFAULT_PERSONA
  }

  /**
   * Check if the current persona differs from the default.
   */
  isCustomized(): boolean {
    return this.persona !== DEFAULT_PERSONA
  }
}

/**
 * Singleton persona store instance.
 */
export const personaStore = new PersonaStore()
