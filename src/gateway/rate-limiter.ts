/**
 * Rate Limiting - Per-minute rate limits with burst protection
 * - Exponential backoff with jitter
 * - Tracks requests per user/API key
 */

export interface RateLimitConfig {
  requestsPerMinute: number;
  burstSize: number; // Allow temporary spike up to this
  backoffBase: number; // Base for exponential backoff
  backoffMultiplier: number;
  jitterFactor: number; // 0-1, adds randomness to backoff
}

export interface RateLimitStatus {
  remaining: number;
  limit: number;
  resetAt: number;
  retryAfter?: number; // seconds, if rate limited
}

/**
 * Rate limiter with sliding window and exponential backoff
 */
export class RateLimiter {
  private config: RateLimitConfig;
  private requestHistory: Map<string, number[]> = new Map();
  private backoffState: Map<string, { attempts: number; nextRetry: number }> = new Map();

  constructor(config: Partial<RateLimitConfig> = {}) {
    this.config = {
      requestsPerMinute: config.requestsPerMinute ?? 60,
      burstSize: config.burstSize ?? 10,
      backoffBase: config.backoffBase ?? 2,
      backoffMultiplier: config.backoffMultiplier ?? 1000, // ms
      jitterFactor: config.jitterFactor ?? 0.1,
    };
  }

  /**
   * Check if request is allowed and update tracking
   */
  checkLimit(identifier: string): { allowed: boolean; status: RateLimitStatus } {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;

    // Get request history for this identifier
    let requests = this.requestHistory.get(identifier) || [];
    requests = requests.filter((time) => time > oneMinuteAgo);

    // Check if backoff is still active
    const backoff = this.backoffState.get(identifier);
    if (backoff && now < backoff.nextRetry) {
      const retryAfter = Math.ceil((backoff.nextRetry - now) / 1000);
      return {
        allowed: false,
        status: {
          remaining: 0,
          limit: this.config.requestsPerMinute,
          resetAt: backoff.nextRetry,
          retryAfter,
        },
      };
    }

    // Allow burst requests
    if (requests.length < this.config.requestsPerMinute + this.config.burstSize) {
      requests.push(now);
      this.requestHistory.set(identifier, requests);

      // Clear backoff on successful request
      this.backoffState.delete(identifier);

      const remaining = Math.max(
        0,
        this.config.requestsPerMinute + this.config.burstSize - requests.length,
      );
      const nextMinute = Math.max(...requests) + 60000;

      return {
        allowed: true,
        status: {
          remaining,
          limit: this.config.requestsPerMinute,
          resetAt: nextMinute,
        },
      };
    }

    // Rate limited - initiate backoff
    const backoffState = backoff || { attempts: 0, nextRetry: 0 };
    backoffState.attempts++;

    const backoffMs = this.calculateBackoff(backoffState.attempts);
    backoffState.nextRetry = now + backoffMs;

    this.backoffState.set(identifier, backoffState);

    const retryAfter = Math.ceil(backoffMs / 1000);

    return {
      allowed: false,
      status: {
        remaining: 0,
        limit: this.config.requestsPerMinute,
        resetAt: backoffState.nextRetry,
        retryAfter,
      },
    };
  }

  /**
   * Calculate exponential backoff with jitter
   */
  private calculateBackoff(attemptNumber: number): number {
    const exponent = Math.min(attemptNumber - 1, 10); // Cap to prevent overflow
    const baseBackoff = this.config.backoffBase ** exponent * this.config.backoffMultiplier;

    // Add jitter
    const jitter = baseBackoff * this.config.jitterFactor * Math.random();

    return baseBackoff + jitter;
  }

  /**
   * Get current limits for identifier
   */
  getStatus(identifier: string): RateLimitStatus {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;

    let requests = this.requestHistory.get(identifier) || [];
    requests = requests.filter((time) => time > oneMinuteAgo);

    const remaining = Math.max(0, this.config.requestsPerMinute - requests.length);
    const nextMinute = requests.length > 0 ? Math.max(...requests) + 60000 : now + 60000;

    const backoff = this.backoffState.get(identifier);

    return {
      remaining,
      limit: this.config.requestsPerMinute,
      resetAt: backoff ? backoff.nextRetry : nextMinute,
      retryAfter: backoff ? Math.ceil((backoff.nextRetry - now) / 1000) : undefined,
    };
  }

  /**
   * Reset rate limit for identifier
   */
  reset(identifier: string): void {
    this.requestHistory.delete(identifier);
    this.backoffState.delete(identifier);
  }

  /**
   * Reset all rate limits
   */
  resetAll(): void {
    this.requestHistory.clear();
    this.backoffState.clear();
  }

  /**
   * Clean up old entries (call periodically)
   */
  cleanup(): number {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    let removed = 0;

    const keysToDelete: string[] = [];

    for (const [key, requests] of this.requestHistory.entries()) {
      const validRequests = requests.filter((time) => time > oneMinuteAgo);
      if (validRequests.length === 0) {
        keysToDelete.push(key);
        removed++;
      } else {
        this.requestHistory.set(key, validRequests);
      }
    }

    keysToDelete.forEach((key) => this.requestHistory.delete(key));

    // Clean backoff state too
    for (const [key, backoff] of this.backoffState.entries()) {
      if (now >= backoff.nextRetry) {
        this.backoffState.delete(key);
        removed++;
      }
    }

    return removed;
  }

  /**
   * Get statistics
   */
  stats(): {
    trackedIdentifiers: number;
    backoffActive: number;
  } {
    return {
      trackedIdentifiers: this.requestHistory.size,
      backoffActive: this.backoffState.size,
    };
  }
}
