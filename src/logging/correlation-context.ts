import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

/**
 * Correlation Context - enables request tracing through the system for debugging
 *
 * Each operation gets a unique correlation ID that flows through logs,
 * allowing you to trace a single operation through the entire system.
 */

export interface CorrelationContext {
  correlationId: string;
  operationName?: string;
  startTime: number;
}

const correlationContextStorage = new AsyncLocalStorage<CorrelationContext>();

/**
 * Generate a new correlation ID (UUID v4)
 */
export function generateCorrelationId(): string {
  return randomUUID();
}

/**
 * Get the current correlation context, or undefined if none is active
 */
export function getCorrelationContext(): CorrelationContext | undefined {
  return correlationContextStorage.getStore();
}

/**
 * Get the current correlation ID, or a new one if none is active
 */
export function getOrCreateCorrelationId(): string {
  const context = getCorrelationContext();
  if (context) {
    return context.correlationId;
  }
  return generateCorrelationId();
}

/**
 * Run a function within a correlation context
 */
export function withCorrelationContext<T>(
  fn: () => T | Promise<T>,
  correlationContext: CorrelationContext,
): T | Promise<T> {
  return correlationContextStorage.run(correlationContext, fn);
}

/**
 * Create and run a function within a new correlation context
 */
export async function withNewCorrelationContext<T>(
  fn: () => T | Promise<T>,
  operationName?: string,
): Promise<T> {
  const context: CorrelationContext = {
    correlationId: generateCorrelationId(),
    operationName,
    startTime: Date.now(),
  };
  return correlationContextStorage.run(context, () => fn());
}

/**
 * Add correlation ID to log object
 */
export function attachCorrelationIdToLog(logObj: Record<string, unknown>): Record<string, unknown> {
  const context = getCorrelationContext();
  if (!context) {
    return logObj;
  }
  return {
    ...logObj,
    correlationId: context.correlationId,
    ...(context.operationName && { operationName: context.operationName }),
  };
}

/**
 * Format correlation ID for logging (for human-readable logs)
 */
export function formatCorrelationIdForLog(): string {
  const context = getCorrelationContext();
  if (!context) {
    return "";
  }
  const id = context.correlationId.substring(0, 8);
  return context.operationName ? `[${context.operationName}:${id}]` : `[${id}]`;
}
