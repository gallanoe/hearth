/**
 * Budget configuration for a day.
 */
export interface BudgetConfig {
    totalTokens: number
    warningThreshold: number // Tokens remaining when warning triggers
  }
  
  /**
   * Current budget state.
   */
  export interface BudgetState {
    total: number
    spent: number
    remaining: number
    warningThreshold: number
    warningIssued: boolean
  }
  
  /**
   * Tracks token budget for a single day.
   */
  export class BudgetTracker {
    private total: number
    private spent: number
    private warningThreshold: number
    private warningIssued: boolean = false
  
    constructor(config: BudgetConfig) {
      this.total = config.totalTokens
      this.spent = 0
      this.warningThreshold = config.warningThreshold
    }
  
    /**
     * Record tokens spent on a turn.
     */
    recordUsage(inputTokens: number, outputTokens: number): void {
      this.spent += inputTokens + outputTokens
    }
  
    /**
     * Get current budget state.
     */
    getState(): BudgetState {
      return {
        total: this.total,
        spent: this.spent,
        remaining: this.total - this.spent,
        warningThreshold: this.warningThreshold,
        warningIssued: this.warningIssued,
      }
    }
  
    /**
     * Check if budget is exhausted.
     */
    isExhausted(): boolean {
      return this.spent >= this.total
    }
  
    /**
     * Check if we should issue a warning (and mark it as issued).
     * Returns true only once when threshold is first crossed.
     */
    shouldWarn(): boolean {
      const remaining = this.total - this.spent
      if (remaining <= this.warningThreshold && !this.warningIssued) {
        this.warningIssued = true
        return true
      }
      return false
    }
  
    /**
     * Check if budget is in warning zone (for display purposes).
     */
    isLow(): boolean {
      return (this.total - this.spent) <= this.warningThreshold
    }
  }