/**
 * Circuit Breaker Pattern Implementation
 *
 * Prevents cascading failures when external services are down.
 *
 * States:
 * - CLOSED: Normal operation, all requests go through
 * - OPEN: Failure threshold exceeded, requests immediately fail
 * - HALF_OPEN: Testing recovery, allowing limited requests through
 */

export type CircuitBreakerState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerConfig {
  /** Number of consecutive failures before opening circuit (default: 5) */
  failureThreshold?: number;
  /** Time in ms to wait before transitioning from OPEN to HALF_OPEN (default: 30000) */
  resetTimeout?: number;
  /** Maximum number of requests allowed in HALF_OPEN state (default: 3) */
  halfOpenRequests?: number;
  /** Name for logging purposes */
  name: string;
}

export interface CircuitBreakerStats {
  state: CircuitBreakerState;
  failureCount: number;
  successCount: number;
  lastFailureTime?: number;
  lastSuccessTime?: number;
}

/**
 * CircuitBreaker implementation with auto-recovery
 */
export class CircuitBreaker {
  private state: CircuitBreakerState = "CLOSED";
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime?: number;
  private lastSuccessTime?: number;
  private resetTimer?: NodeJS.Timeout;
  private halfOpenRequestCount = 0;

  private readonly failureThreshold: number;
  private readonly resetTimeout: number;
  private readonly halfOpenRequests: number;
  private readonly name: string;

  constructor(config: CircuitBreakerConfig) {
    this.failureThreshold = config.failureThreshold ?? 5;
    this.resetTimeout = config.resetTimeout ?? 30000;
    this.halfOpenRequests = config.halfOpenRequests ?? 3;
    this.name = config.name;
  }

  /**
   * Get current circuit breaker state
   */
  getState(): CircuitBreakerState {
    return this.state;
  }

  /**
   * Get current statistics
   */
  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
    };
  }

  /**
   * Execute a request through the circuit breaker
   * Returns true if the request is allowed, false if circuit is open
   */
  async execute<T>(fn: () => Promise<T>, onFailure?: (error: Error) => void): Promise<T> {
    // Check if we should transition from OPEN to HALF_OPEN
    if (this.state === "OPEN" && this.shouldAttemptReset()) {
      this.transitionToHalfOpen();
    }

    // If circuit is open, fail fast
    if (this.state === "OPEN") {
      throw new Error(
        `Circuit breaker "${this.name}" is OPEN. Service is unavailable. ` +
          `Will retry in ${Math.ceil(this.resetTimeout / 1000)}s.`,
      );
    }

    // If in HALF_OPEN state, limit concurrent requests
    if (this.state === "HALF_OPEN" && this.halfOpenRequestCount >= this.halfOpenRequests) {
      throw new Error(
        `Circuit breaker "${this.name}" is HALF_OPEN and request limit exceeded. ` +
          `Current: ${this.halfOpenRequestCount}/${this.halfOpenRequests}.`,
      );
    }

    if (this.state === "HALF_OPEN") {
      this.halfOpenRequestCount++;
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.recordFailure();
      onFailure?.(err);
      throw err;
    } finally {
      if (this.state === "HALF_OPEN") {
        this.halfOpenRequestCount = Math.max(0, this.halfOpenRequestCount - 1);
      }
    }
  }

  /**
   * Record a successful request
   */
  private recordSuccess(): void {
    this.lastSuccessTime = Date.now();
    this.successCount++;
    this.failureCount = 0;

    // If we're in HALF_OPEN and this succeeds, transition back to CLOSED
    if (this.state === "HALF_OPEN") {
      this.transitionToClosed();
    }
  }

  /**
   * Record a failed request
   */
  private recordFailure(): void {
    this.lastFailureTime = Date.now();
    this.failureCount++;

    if (this.state === "HALF_OPEN") {
      // Any failure in HALF_OPEN triggers immediate OPEN transition
      this.transitionToOpen();
      return;
    }

    // If failure threshold reached, open circuit
    if (this.failureCount >= this.failureThreshold && this.state === "CLOSED") {
      this.transitionToOpen();
    }
  }

  /**
   * Check if we should attempt to recover from OPEN state
   */
  private shouldAttemptReset(): boolean {
    if (!this.lastFailureTime) {
      return false;
    }
    return Date.now() - this.lastFailureTime >= this.resetTimeout;
  }

  /**
   * Transition to CLOSED state (normal operation)
   */
  private transitionToClosed(): void {
    if (this.state === "CLOSED") {
      return;
    }
    this.clearResetTimer();
    this.state = "CLOSED";
    this.failureCount = 0;
    this.successCount = 0;
    this.halfOpenRequestCount = 0;
  }

  /**
   * Transition to OPEN state (failure detected)
   */
  private transitionToOpen(): void {
    if (this.state === "OPEN") {
      return;
    }
    this.clearResetTimer();
    this.state = "OPEN";
    this.halfOpenRequestCount = 0;

    // Schedule automatic transition to HALF_OPEN after resetTimeout
    this.resetTimer = setTimeout(() => {
      if (this.state === "OPEN") {
        this.transitionToHalfOpen();
      }
    }, this.resetTimeout);
  }

  /**
   * Transition to HALF_OPEN state (testing recovery)
   */
  private transitionToHalfOpen(): void {
    if (this.state === "HALF_OPEN") {
      return;
    }
    this.clearResetTimer();
    this.state = "HALF_OPEN";
    this.successCount = 0;
    this.failureCount = 0;
    this.halfOpenRequestCount = 0;
  }

  /**
   * Clear the reset timer
   */
  private clearResetTimer(): void {
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
      this.resetTimer = undefined;
    }
  }

  /**
   * Reset circuit breaker to CLOSED state (for testing)
   */
  reset(): void {
    this.transitionToClosed();
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.clearResetTimer();
  }
}

/**
 * Registry to manage multiple circuit breakers
 */
export class CircuitBreakerRegistry {
  private breakers = new Map<string, CircuitBreaker>();

  /**
   * Get or create a circuit breaker
   */
  getOrCreate(name: string, config?: Omit<CircuitBreakerConfig, "name">): CircuitBreaker {
    let breaker = this.breakers.get(name);
    if (!breaker) {
      breaker = new CircuitBreaker({ ...config, name });
      this.breakers.set(name, breaker);
    }
    return breaker;
  }

  /**
   * Get an existing circuit breaker
   */
  get(name: string): CircuitBreaker | undefined {
    return this.breakers.get(name);
  }

  /**
   * Get all circuit breakers with their stats
   */
  getAll(): Map<string, CircuitBreakerStats> {
    const stats = new Map<string, CircuitBreakerStats>();
    for (const [name, breaker] of this.breakers) {
      stats.set(name, breaker.getStats());
    }
    return stats;
  }

  /**
   * Reset all circuit breakers (for testing)
   */
  resetAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
  }

  /**
   * Cleanup all resources
   */
  destroy(): void {
    for (const breaker of this.breakers.values()) {
      breaker.destroy();
    }
    this.breakers.clear();
  }
}

// Global registry
export const circuitBreakerRegistry = new CircuitBreakerRegistry();

/**
 * Get a named circuit breaker from the global registry
 */
export function getCircuitBreaker(name: string): CircuitBreaker {
  return circuitBreakerRegistry.getOrCreate(name, {
    failureThreshold: 5,
    resetTimeout: 30000,
    halfOpenRequests: 3,
  });
}
