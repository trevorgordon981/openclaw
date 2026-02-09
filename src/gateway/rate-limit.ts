import type { ServerResponse } from "node:http";

/**
 * Simple in-memory sliding-window rate limiter keyed by IP address.
 * Intended for gateway HTTP endpoints (hooks, OpenAI-compat API).
 *
 * Not shared across processes — suitable for single-process gateways.
 */

interface RateLimitEntry {
  tokens: number;
  lastRefill: number;
}

export interface RateLimiterOptions {
  /** Max requests per window (default: 120) */
  maxRequests?: number;
  /** Window duration in ms (default: 60_000 = 1 minute) */
  windowMs?: number;
  /** Max number of tracked IPs before evicting oldest (default: 10_000) */
  maxEntries?: number;
}

export class RateLimiter {
  private readonly max: number;
  private readonly windowMs: number;
  private readonly maxEntries: number;
  private readonly buckets = new Map<string, RateLimitEntry>();

  constructor(opts: RateLimiterOptions = {}) {
    this.max = opts.maxRequests ?? 120;
    this.windowMs = opts.windowMs ?? 60_000;
    this.maxEntries = opts.maxEntries ?? 10_000;
  }

  /**
   * Check if a request should be allowed. Returns true if allowed, false if rate-limited.
   * Uses a token-bucket algorithm with per-window refill.
   */
  allow(key: string): boolean {
    const now = Date.now();
    let entry = this.buckets.get(key);

    if (!entry) {
      // Evict oldest entries if we exceed maxEntries
      if (this.buckets.size >= this.maxEntries) {
        const firstKey = this.buckets.keys().next().value;
        if (firstKey !== undefined) {
          this.buckets.delete(firstKey);
        }
      }
      entry = { tokens: this.max - 1, lastRefill: now };
      this.buckets.set(key, entry);
      return true;
    }

    // Refill tokens based on elapsed time
    const elapsed = now - entry.lastRefill;
    if (elapsed >= this.windowMs) {
      entry.tokens = this.max - 1;
      entry.lastRefill = now;
      return true;
    }

    if (entry.tokens > 0) {
      entry.tokens--;
      return true;
    }

    return false;
  }

  /** Returns remaining tokens for a key (for headers). */
  remaining(key: string): number {
    return this.buckets.get(key)?.tokens ?? this.max;
  }
}

/**
 * Send a 429 Too Many Requests response.
 */
export function sendRateLimited(res: ServerResponse): void {
  res.statusCode = 429;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Retry-After", "60");
  res.end("Too Many Requests");
}
