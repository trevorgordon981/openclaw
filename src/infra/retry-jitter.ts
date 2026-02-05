/**
 * Retry Jitter Utility
 *
 * Adds randomized jitter to exponential backoff to prevent thundering herd.
 * When multiple instances retry simultaneously, jitter spreads out the retry attempts.
 *
 * Formula: delay = baseDelay * Math.pow(2, attempt) + Math.random() * jitterFactor
 */

/**
 * Configuration for retry with jitter
 */
export interface RetryWithJitterConfig {
  /** Base delay in milliseconds (default: 100ms) */
  baseDelay?: number;
  /** Maximum jitter factor in milliseconds (default: 1000ms) */
  jitterFactor?: number;
  /** Maximum number of retry attempts (default: 3) */
  maxAttempts?: number;
  /** Maximum delay cap in milliseconds (default: 300000ms = 5 minutes) */
  maxDelay?: number;
  /** Optional logger for debugging */
  logger?: { debug?: (msg: string) => void };
}

/**
 * Calculate delay with exponential backoff and jitter
 *
 * @param attempt - Current attempt number (0-indexed)
 * @param config - Configuration for retry behavior
 * @returns Delay in milliseconds
 */
export function calculateDelayWithJitter(
  attempt: number,
  config: RetryWithJitterConfig = {},
): number {
  const baseDelay = config.baseDelay ?? 100;
  const jitterFactor = config.jitterFactor ?? 1000;
  const maxDelay = config.maxDelay ?? 300000;

  if (attempt < 0) {
    return 0;
  }

  // Exponential backoff: baseDelay * 2^attempt
  const exponentialDelay = baseDelay * Math.pow(2, attempt);

  // Add random jitter: random value between 0 and jitterFactor
  const jitter = Math.random() * jitterFactor;

  // Calculate total delay
  const totalDelay = exponentialDelay + jitter;

  // Cap at maximum delay
  const cappedDelay = Math.min(totalDelay, maxDelay);

  config.logger?.debug?.(
    `retry-jitter: attempt=${attempt}, exponential=${exponentialDelay}ms, ` +
      `jitter=${jitter}ms, total=${totalDelay}ms, capped=${cappedDelay}ms`,
  );

  return Math.ceil(cappedDelay);
}

/**
 * Sleep for a specified duration
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff and jitter
 */
export async function retryWithJitter<T>(
  fn: () => Promise<T>,
  config: RetryWithJitterConfig & {
    onError?: (error: Error, attempt: number) => void;
  } = {},
): Promise<T> {
  const maxAttempts = config.maxAttempts ?? 3;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      config.onError?.(err, attempt);

      if (attempt === maxAttempts - 1) {
        throw err;
      }

      const delay = calculateDelayWithJitter(attempt, config);
      await sleep(delay);
    }
  }

  throw new Error("Retry exhausted");
}

/**
 * Retry a function with jitter for a specific error condition
 */
export async function retryWithJitterOnCondition<T>(
  fn: () => Promise<T>,
  shouldRetry: (error: unknown, attempt: number) => boolean,
  config: RetryWithJitterConfig & {
    onError?: (error: Error, attempt: number) => void;
  } = {},
): Promise<T> {
  const maxAttempts = config.maxAttempts ?? 3;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      if (!shouldRetry(err, attempt)) {
        throw err;
      }

      config.onError?.(err, attempt);

      if (attempt === maxAttempts - 1) {
        throw err;
      }

      const delay = calculateDelayWithJitter(attempt, config);
      await sleep(delay);
    }
  }

  throw new Error("Retry exhausted");
}

/**
 * Rate limit specific backoff configuration (for API rate limits)
 */
export const RATE_LIMIT_RETRY_CONFIG: RetryWithJitterConfig = {
  baseDelay: 1000, // Start with 1 second
  jitterFactor: 2000, // Up to 2 seconds of jitter
  maxAttempts: 5,
  maxDelay: 120000, // Cap at 2 minutes
};

/**
 * Server error backoff configuration (for 5xx errors)
 */
export const SERVER_ERROR_RETRY_CONFIG: RetryWithJitterConfig = {
  baseDelay: 500, // Start with 500ms
  jitterFactor: 1000, // Up to 1 second of jitter
  maxAttempts: 4,
  maxDelay: 60000, // Cap at 1 minute
};

/**
 * Transient error backoff configuration (for temporary failures)
 */
export const TRANSIENT_ERROR_RETRY_CONFIG: RetryWithJitterConfig = {
  baseDelay: 100, // Start with 100ms
  jitterFactor: 500, // Up to 500ms of jitter
  maxAttempts: 3,
  maxDelay: 30000, // Cap at 30 seconds
};

/**
 * Health check backoff configuration (for node health checks)
 */
export const HEALTH_CHECK_RETRY_CONFIG: RetryWithJitterConfig = {
  baseDelay: 500, // Start with 500ms
  jitterFactor: 1000, // Up to 1 second of jitter
  maxAttempts: 3,
  maxDelay: 15000, // Cap at 15 seconds
};
