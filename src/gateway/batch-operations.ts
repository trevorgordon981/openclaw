/**
 * Batch Operations (Item 6)
 * Combine multiple requests into batches
 * 10% cost savings
 */

export interface BatchRequest<T> {
  id: string;
  data: T;
  timestamp: number;
  priority?: number;
}

export interface BatchResult<T, R> {
  batchId: string;
  requests: Array<{
    id: string;
    result: R | null;
    error?: Error;
  }>;
  createdAt: number;
  processedAt: number;
}

export type BatchProcessor<T, R> = (items: T[]) => Promise<R[]>;

/**
 * Manages batch operations with configurable batching strategy
 */
export class BatchOperationManager<T, R> {
  private queue: BatchRequest<T>[] = [];
  private maxBatchSize: number;
  private maxWaitMs: number;
  private allowPartialBatches: boolean;
  private batchTimer: NodeJS.Timeout | null = null;
  private processor: BatchProcessor<T, R>;
  private processedBatches: Map<string, BatchResult<T, R>> = new Map();

  constructor(
    processor: BatchProcessor<T, R>,
    maxBatchSize: number = 5,
    maxWaitMs: number = 500,
    allowPartialBatches: boolean = true,
  ) {
    this.processor = processor;
    this.maxBatchSize = maxBatchSize;
    this.maxWaitMs = maxWaitMs;
    this.allowPartialBatches = allowPartialBatches;
  }

  /**
   * Add request to batch queue
   */
  async add(id: string, data: T, priority: number = 0): Promise<R | null> {
    return new Promise((resolve, reject) => {
      const request: BatchRequest<T> = {
        id,
        data,
        timestamp: Date.now(),
        priority,
      };

      this.queue.push(request);

      // Sort by priority (higher priority first)
      this.queue.sort((a, b) => (b.priority || 0) - (a.priority || 0));

      // Process if batch is full
      if (this.queue.length >= this.maxBatchSize) {
        this.processBatch()
          .then((result) => {
            const item = result.requests.find((r) => r.id === id);
            resolve(item?.result ?? null);
          })
          .catch(reject);
      } else if (!this.batchTimer) {
        // Set timer if not already set
        this.batchTimer = setTimeout(() => {
          this.processBatch()
            .then((result) => {
              const item = result.requests.find((r) => r.id === id);
              resolve(item?.result ?? null);
            })
            .catch(reject);
        }, this.maxWaitMs);
      }
    });
  }

  /**
   * Process current batch
   */
  private async processBatch(): Promise<BatchResult<T, R>> {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    if (this.queue.length === 0) {
      throw new Error("No requests in queue");
    }

    // Take up to maxBatchSize items
    const batchRequests = this.queue.splice(0, this.maxBatchSize);
    const batchId = `batch-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const createdAt = Date.now();

    try {
      // Extract data in order
      const data = batchRequests.map((r) => r.data);

      // Process batch
      const results = await this.processor(data);

      // Map results back to requests
      const batchResult: BatchResult<T, R> = {
        batchId,
        requests: batchRequests.map((req, index) => ({
          id: req.id,
          result: results[index] || null,
          error: undefined,
        })),
        createdAt,
        processedAt: Date.now(),
      };

      this.processedBatches.set(batchId, batchResult);

      // Keep only recent batches
      if (this.processedBatches.size > 100) {
        const oldestKey = Array.from(this.processedBatches.keys())[0];
        this.processedBatches.delete(oldestKey);
      }

      return batchResult;
    } catch (error) {
      // Return error for all requests in batch
      const batchResult: BatchResult<T, R> = {
        batchId,
        requests: batchRequests.map((req) => ({
          id: req.id,
          result: null,
          error: error instanceof Error ? error : new Error(String(error)),
        })),
        createdAt,
        processedAt: Date.now(),
      };

      this.processedBatches.set(batchId, batchResult);
      throw error;
    }
  }

  /**
   * Force process current batch immediately
   */
  async flush(): Promise<BatchResult<T, R> | null> {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    if (this.queue.length === 0) {
      return null;
    }

    return this.processBatch();
  }

  /**
   * Get batch result by ID
   */
  getBatchResult(batchId: string): BatchResult<T, R> | null {
    return this.processedBatches.get(batchId) || null;
  }

  /**
   * Get queue statistics
   */
  stats(): {
    queueSize: number;
    maxBatchSize: number;
    pendingBatches: number;
    avgBatchTime: number;
  } {
    const batches = Array.from(this.processedBatches.values());
    const totalBatchTime = batches.reduce((sum, b) => sum + (b.processedAt - b.createdAt), 0);
    const avgBatchTime = batches.length > 0 ? totalBatchTime / batches.length : 0;

    return {
      queueSize: this.queue.length,
      maxBatchSize: this.maxBatchSize,
      pendingBatches: this.processedBatches.size,
      avgBatchTime: Math.round(avgBatchTime * 100) / 100,
    };
  }

  /**
   * Clear queue
   */
  clear(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    this.queue = [];
  }
}
