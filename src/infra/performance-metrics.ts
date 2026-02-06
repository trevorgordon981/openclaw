/**
 * performance-metrics.ts
 * 
 * Track and report performance metrics including token savings,
 * cache hit rates, latency measurements, and cost improvements.
 * 
 * Purpose: Monitor optimization effectiveness
 * Usage: Integrate into hot paths for automatic metric collection
 */

export interface LatencyStats {
  count: number;
  totalMs: number;
  minMs: number;
  maxMs: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  evictions: number;
  averageEntrySize: number;
}

export interface TokenMetrics {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  compressedInputTokens: number;
  compressedOutputTokens: number;
  savedTokens: number;
  compressionRatio: number;
}

export interface CostMetrics {
  totalCostUsd: number;
  totalCostSaved: number;
  costPerToken: number;
  costPerOperation: number;
  cacheROI: number; // ratio of tokens saved to cache overhead
}

export interface PerformanceReport {
  timestamp: number;
  period: {
    startTime: number;
    endTime: number;
    durationMs: number;
  };
  tokens: TokenMetrics;
  latency: {
    toolInvocation: LatencyStats;
    messageSerialization: LatencyStats;
    costCalculation: LatencyStats;
    compression: LatencyStats;
  };
  cache: {
    httpResponses: CacheStats;
    toolResults: CacheStats;
    configObjects: CacheStats;
    memorySearch: CacheStats;
  };
  costs: CostMetrics;
  operations: {
    toolInvocations: number;
    messagesSent: number;
    cacheOperations: number;
    apiCalls: number;
  };
}

/**
 * High-resolution timer for latency tracking
 */
class LatencyTracker {
  private measurements: number[] = [];
  private sorted: boolean = false;

  record(durationMs: number): void {
    this.measurements.push(durationMs);
    this.sorted = false;
  }

  getStats(): LatencyStats {
    if (this.measurements.length === 0) {
      return {
        count: 0,
        totalMs: 0,
        minMs: 0,
        maxMs: 0,
        meanMs: 0,
        p50Ms: 0,
        p95Ms: 0,
        p99Ms: 0,
      };
    }

    if (!this.sorted) {
      this.measurements.sort((a, b) => a - b);
      this.sorted = true;
    }

    const count = this.measurements.length;
    const totalMs = this.measurements.reduce((a, b) => a + b, 0);
    const minMs = this.measurements[0];
    const maxMs = this.measurements[count - 1];
    const meanMs = totalMs / count;

    const getPercentile = (p: number): number => {
      const index = Math.ceil((p / 100) * count) - 1;
      return this.measurements[Math.max(0, index)];
    };

    return {
      count,
      totalMs,
      minMs,
      maxMs,
      meanMs,
      p50Ms: getPercentile(50),
      p95Ms: getPercentile(95),
      p99Ms: getPercentile(99),
    };
  }

  reset(): void {
    this.measurements = [];
    this.sorted = false;
  }
}

/**
 * Central metrics collector
 */
export class PerformanceMetricsCollector {
  private startTime: number = Date.now();
  private latencyTrackers = {
    toolInvocation: new LatencyTracker(),
    messageSerialization: new LatencyTracker(),
    costCalculation: new LatencyTracker(),
    compression: new LatencyTracker(),
  };

  private cacheStats = {
    httpResponses: { hits: 0, misses: 0, evictions: 0, sizes: [] as number[] },
    toolResults: { hits: 0, misses: 0, evictions: 0, sizes: [] as number[] },
    configObjects: { hits: 0, misses: 0, evictions: 0, sizes: [] as number[] },
    memorySearch: { hits: 0, misses: 0, evictions: 0, sizes: [] as number[] },
  };

  private tokenMetrics: TokenMetrics = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    compressedInputTokens: 0,
    compressedOutputTokens: 0,
    savedTokens: 0,
    compressionRatio: 0,
  };

  private operations = {
    toolInvocations: 0,
    messagesSent: 0,
    cacheOperations: 0,
    apiCalls: 0,
  };

  private costMetrics: CostMetrics = {
    totalCostUsd: 0,
    totalCostSaved: 0,
    costPerToken: 0,
    costPerOperation: 0,
    cacheROI: 0,
  };

  /**
   * Record latency measurement
   */
  recordLatency(
    category: "toolInvocation" | "messageSerialization" | "costCalculation" | "compression",
    durationMs: number,
  ): void {
    this.latencyTrackers[category].record(durationMs);
  }

  /**
   * Record cache hit
   */
  recordCacheHit(
    type: "httpResponses" | "toolResults" | "configObjects" | "memorySearch",
  ): void {
    this.cacheStats[type].hits++;
    this.operations.cacheOperations++;
  }

  /**
   * Record cache miss
   */
  recordCacheMiss(
    type: "httpResponses" | "toolResults" | "configObjects" | "memorySearch",
  ): void {
    this.cacheStats[type].misses++;
    this.operations.cacheOperations++;
  }

  /**
   * Record cache eviction
   */
  recordCacheEviction(
    type: "httpResponses" | "toolResults" | "configObjects" | "memorySearch",
  ): void {
    this.cacheStats[type].evictions++;
  }

  /**
   * Record token usage
   */
  recordTokens(tokens: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
  }): void {
    if (tokens.input) this.tokenMetrics.inputTokens += tokens.input;
    if (tokens.output) this.tokenMetrics.outputTokens += tokens.output;
    if (tokens.cacheRead) this.tokenMetrics.cacheReadTokens += tokens.cacheRead;
    if (tokens.cacheWrite) this.tokenMetrics.cacheWriteTokens += tokens.cacheWrite;
    this.tokenMetrics.totalTokens = this.getTotalTokens();
  }

  /**
   * Record compressed tokens
   */
  recordCompressedTokens(
    originalSize: number,
    compressedSize: number,
    isInput: boolean,
  ): void {
    const saved = originalSize - compressedSize;
    if (isInput) {
      this.tokenMetrics.compressedInputTokens += compressedSize;
    } else {
      this.tokenMetrics.compressedOutputTokens += compressedSize;
    }
    this.tokenMetrics.savedTokens += saved;
  }

  /**
   * Record tool invocation
   */
  recordToolInvocation(): void {
    this.operations.toolInvocations++;
  }

  /**
   * Record message sent
   */
  recordMessageSent(): void {
    this.operations.messagesSent++;
  }

  /**
   * Record API call
   */
  recordApiCall(): void {
    this.operations.apiCalls++;
  }

  /**
   * Record cost
   */
  recordCost(costUsd: number, savedCostUsd: number = 0): void {
    this.costMetrics.totalCostUsd += costUsd;
    this.costMetrics.totalCostSaved += savedCostUsd;
  }

  /**
   * Get current metrics report
   */
  getReport(): PerformanceReport {
    const endTime = Date.now();
    const durationMs = endTime - this.startTime;

    const totalTokens = this.getTotalTokens();
    const compressionRatio =
      totalTokens > 0
        ? (this.tokenMetrics.compressedInputTokens + this.tokenMetrics.compressedOutputTokens) /
          totalTokens
        : 0;

    const cacheOperations = this.operations.cacheOperations || 1;
    const httpHitRate =
      (this.cacheStats.httpResponses.hits || 0) /
      (this.cacheStats.httpResponses.hits + this.cacheStats.httpResponses.misses || 1);
    const toolHitRate =
      (this.cacheStats.toolResults.hits || 0) /
      (this.cacheStats.toolResults.hits + this.cacheStats.toolResults.misses || 1);

    const totalOperations =
      this.operations.toolInvocations +
      this.operations.messagesSent +
      this.operations.apiCalls;
    const costPerOperation = totalOperations > 0 ? this.costMetrics.totalCostUsd / totalOperations : 0;

    const cacheOverhead =
      (this.cacheStats.httpResponses.evictions +
        this.cacheStats.toolResults.evictions) *
      0.001;
    const cacheROI =
      cacheOverhead > 0 ? this.tokenMetrics.savedTokens / cacheOverhead : 0;

    return {
      timestamp: endTime,
      period: {
        startTime: this.startTime,
        endTime,
        durationMs,
      },
      tokens: {
        ...this.tokenMetrics,
        compressionRatio,
      },
      latency: {
        toolInvocation: this.latencyTrackers.toolInvocation.getStats(),
        messageSerialization: this.latencyTrackers.messageSerialization.getStats(),
        costCalculation: this.latencyTrackers.costCalculation.getStats(),
        compression: this.latencyTrackers.compression.getStats(),
      },
      cache: {
        httpResponses: {
          hits: this.cacheStats.httpResponses.hits,
          misses: this.cacheStats.httpResponses.misses,
          hitRate: httpHitRate,
          evictions: this.cacheStats.httpResponses.evictions,
          averageEntrySize: 0,
        },
        toolResults: {
          hits: this.cacheStats.toolResults.hits,
          misses: this.cacheStats.toolResults.misses,
          hitRate: toolHitRate,
          evictions: this.cacheStats.toolResults.evictions,
          averageEntrySize: 0,
        },
        configObjects: {
          hits: this.cacheStats.configObjects.hits,
          misses: this.cacheStats.configObjects.misses,
          hitRate: this.cacheStats.configObjects.hits /
            (this.cacheStats.configObjects.hits + this.cacheStats.configObjects.misses || 1),
          evictions: this.cacheStats.configObjects.evictions,
          averageEntrySize: 0,
        },
        memorySearch: {
          hits: this.cacheStats.memorySearch.hits,
          misses: this.cacheStats.memorySearch.misses,
          hitRate: this.cacheStats.memorySearch.hits /
            (this.cacheStats.memorySearch.hits + this.cacheStats.memorySearch.misses || 1),
          evictions: this.cacheStats.memorySearch.evictions,
          averageEntrySize: 0,
        },
      },
      costs: {
        totalCostUsd: this.costMetrics.totalCostUsd,
        totalCostSaved: this.costMetrics.totalCostSaved,
        costPerToken: totalTokens > 0 ? this.costMetrics.totalCostUsd / totalTokens : 0,
        costPerOperation,
        cacheROI,
      },
      operations: this.operations,
    };
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.startTime = Date.now();
    this.latencyTrackers.toolInvocation.reset();
    this.latencyTrackers.messageSerialization.reset();
    this.latencyTrackers.costCalculation.reset();
    this.latencyTrackers.compression.reset();

    for (const key in this.cacheStats) {
      const stat = this.cacheStats[key as keyof typeof this.cacheStats];
      stat.hits = 0;
      stat.misses = 0;
      stat.evictions = 0;
      stat.sizes = [];
    }

    this.tokenMetrics = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      compressedInputTokens: 0,
      compressedOutputTokens: 0,
      savedTokens: 0,
      compressionRatio: 0,
    };

    this.operations = {
      toolInvocations: 0,
      messagesSent: 0,
      cacheOperations: 0,
      apiCalls: 0,
    };

    this.costMetrics = {
      totalCostUsd: 0,
      totalCostSaved: 0,
      costPerToken: 0,
      costPerOperation: 0,
      cacheROI: 0,
    };
  }

  private getTotalTokens(): number {
    return (
      this.tokenMetrics.inputTokens +
      this.tokenMetrics.outputTokens +
      this.tokenMetrics.cacheReadTokens +
      this.tokenMetrics.cacheWriteTokens
    );
  }
}

// Global singleton
let globalCollector: PerformanceMetricsCollector | null = null;

/**
 * Get or create global metrics collector
 */
export function getGlobalMetricsCollector(): PerformanceMetricsCollector {
  if (!globalCollector) {
    globalCollector = new PerformanceMetricsCollector();
  }
  return globalCollector;
}

/**
 * Reset global collector
 */
export function resetGlobalMetricsCollector(): void {
  globalCollector = null;
}
