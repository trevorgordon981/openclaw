/**
 * Resource Cleanup Guarantees
 *
 * Utilities to ensure cleanup happens reliably even on error paths.
 * Prevents resource leaks (WebSocket listeners, database connections, node connections, etc.)
 */

/**
 * A resource that can be cleaned up
 */
export interface Cleanable {
  cleanup(): void | Promise<void>;
}

/**
 * Cleanup manager to track and clean resources
 */
export class CleanupManager {
  private resources: Cleanable[] = [];
  private cleanupInProgress = false;

  /**
   * Register a resource for cleanup
   * Returns the resource for convenience chaining
   */
  register<T extends Cleanable>(resource: T): T {
    this.resources.push(resource);
    return resource;
  }

  /**
   * Cleanup all registered resources in reverse order
   * Continues even if individual cleanups fail
   */
  async cleanupAll(): Promise<Array<{ resource: Cleanable; error?: Error }>> {
    if (this.cleanupInProgress) {
      return [];
    }

    this.cleanupInProgress = true;
    const results: Array<{ resource: Cleanable; error?: Error }> = [];

    // Cleanup in reverse order (LIFO - last registered first)
    for (let i = this.resources.length - 1; i >= 0; i--) {
      const resource = this.resources[i];
      try {
        await Promise.resolve(resource.cleanup());
        results.push({ resource });
      } catch (error) {
        results.push({
          resource,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }

    this.cleanupInProgress = false;
    return results;
  }

  /**
   * Get count of registered resources
   */
  getResourceCount(): number {
    return this.resources.length;
  }

  /**
   * Clear the resource list (without cleaning)
   */
  clear(): void {
    this.resources = [];
  }
}

/**
 * Create a resource from a cleanup function
 */
export function createResource(cleanup: () => void | Promise<void>): Cleanable {
  return { cleanup };
}

/**
 * Wrap a function with automatic resource cleanup using AbortController
 */
export function withAbortSignal<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  onSignal?: () => void | Promise<void>,
): { promise: Promise<T>; abort: () => void } {
  const controller = new AbortController();

  const wrappedFn = async (): Promise<T> => {
    try {
      return await fn(controller.signal);
    } finally {
      if (onSignal) {
        await Promise.resolve(onSignal());
      }
    }
  };

  return {
    promise: wrappedFn(),
    abort: () => {
      onSignal?.();
      controller.abort();
    },
  };
}

/**
 * Ensure cleanup happens even on error
 * Similar to try/finally pattern
 */
export async function withCleanup<T>(
  fn: () => Promise<T>,
  cleanup: () => void | Promise<void>,
): Promise<T> {
  try {
    return await fn();
  } finally {
    await Promise.resolve(cleanup());
  }
}

/**
 * Resource tracking for listeners/subscriptions
 */
export class ListenerManager {
  private listeners: Array<{
    emitter: any;
    event: string;
    handler: (...args: any[]) => void;
  }> = [];

  /**
   * Register an event listener and track it for cleanup
   */
  on(emitter: any, event: string, handler: (...args: any[]) => void): () => void {
    if (typeof emitter.on === "function") {
      emitter.on(event, handler);
      this.listeners.push({ emitter, event, handler });

      // Return a removal function
      return () => this.off(emitter, event, handler);
    }
    return () => {
      /* no-op */
    };
  }

  /**
   * Register a one-time event listener
   */
  once(emitter: any, event: string, handler: (...args: any[]) => void): () => void {
    if (typeof emitter.once === "function") {
      const wrappedHandler = (...args: any[]) => {
        this.off(emitter, event, wrappedHandler);
        handler(...args);
      };

      emitter.once(event, wrappedHandler);
      this.listeners.push({ emitter, event, handler: wrappedHandler });

      // Return a removal function
      return () => this.off(emitter, event, wrappedHandler);
    }
    return () => {
      /* no-op */
    };
  }

  /**
   * Unregister an event listener
   */
  off(emitter: any, event: string, handler: (...args: any[]) => void): void {
    if (typeof emitter.off === "function" || typeof emitter.removeListener === "function") {
      const removeFn = emitter.off || emitter.removeListener;
      removeFn.call(emitter, event, handler);

      this.listeners = this.listeners.filter(
        (l) => !(l.emitter === emitter && l.event === event && l.handler === handler),
      );
    }
  }

  /**
   * Remove all registered listeners
   */
  removeAll(): void {
    // Remove in reverse order
    for (let i = this.listeners.length - 1; i >= 0; i--) {
      const { emitter, event, handler } = this.listeners[i];
      if (typeof emitter.off === "function" || typeof emitter.removeListener === "function") {
        const removeFn = emitter.off || emitter.removeListener;
        removeFn.call(emitter, event, handler);
      }
    }
    this.listeners = [];
  }

  /**
   * Get count of registered listeners
   */
  getListenerCount(): number {
    return this.listeners.length;
  }
}

/**
 * Connection pool tracking for cleanup
 */
export class ConnectionPool {
  private connections = new Set<any>();

  /**
   * Register a connection
   */
  add(connection: any): void {
    this.connections.add(connection);
  }

  /**
   * Unregister a connection
   */
  remove(connection: any): void {
    this.connections.delete(connection);
  }

  /**
   * Close all connections
   */
  async closeAll(): Promise<Array<{ connection: any; error?: Error }>> {
    const results: Array<{ connection: any; error?: Error }> = [];

    for (const connection of this.connections) {
      try {
        if (typeof connection.close === "function") {
          await Promise.resolve(connection.close());
        } else if (typeof connection.destroy === "function") {
          connection.destroy();
        }
        results.push({ connection });
      } catch (error) {
        results.push({
          connection,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }

    this.connections.clear();
    return results;
  }

  /**
   * Get count of active connections
   */
  getConnectionCount(): number {
    return this.connections.size;
  }
}

/**
 * Global cleanup manager for application-wide resource management
 */
export const globalCleanupManager = new CleanupManager();

/**
 * Register application shutdown handler
 */
export function registerShutdownHandler(handler: () => void | Promise<void>): void {
  const cleanup = () => Promise.resolve(handler());

  process.on("SIGTERM", async () => {
    await cleanup();
    process.exit(0);
  });

  process.on("SIGINT", async () => {
    await cleanup();
    process.exit(0);
  });
}
