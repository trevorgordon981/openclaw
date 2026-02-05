/**
 * Gateway Optimization Configuration Hub
 *
 * Central configuration for optimization features:
 * - Item 5: Vector Caching
 * - Item 6: Batch Operations
 * - Item 7: Response Truncation
 * - Item 8: Tool Filtering
 * - Item 9: Session Compression
 * - Item 12: Config-Driven Optimization Levels
 */

/**
 * Optimization Levels with estimated cost savings
 */
export enum OptimizationLevel {
  PERFORMANCE_FIRST = "performance-first", // 0-5% savings, prioritize speed
  BALANCED = "balanced", // 15-25% savings
  AGGRESSIVE = "aggressive", // 25-35% savings, prioritize cost
}

/**
 * Vector Caching Configuration (Item 5)
 * Cache embeddings for semantic similarity queries
 * Estimated: 8% cost savings
 */
export interface VectorCachingConfig {
  enabled: boolean;
  maxVectors: number;
  ttlMs: number;
  similarityThreshold: number; // 0-1, higher = more selective
  useApproximateMatching: boolean;
}

/**
 * Batch Operations Configuration (Item 6)
 * Combine multiple requests into batches
 * Estimated: 10% cost savings
 */
export interface BatchOperationsConfig {
  enabled: boolean;
  maxBatchSize: number;
  maxWaitMs: number;
  allowPartialBatches: boolean;
  groupingStrategy: "model" | "complexity" | "user" | "combined";
}

/**
 * Response Truncation Configuration (Item 7)
 * Smart truncation at sentence boundaries
 * Customizable max tokens
 */
export interface ResponseTruncationConfig {
  enabled: boolean;
  maxTokens: number;
  truncateAtSentence: boolean;
  preserveCodeBlocks: boolean;
  ellipsisIndicator: string;
}

/**
 * Tool Filtering Configuration (Item 8)
 * Only expose relevant tools per task
 * Context + complexity-based filtering
 */
export interface ToolFilteringConfig {
  enabled: boolean;
  enableSemanticMatching: boolean;
  minRelevanceScore: number; // 0-1
  exposureStrategy: "minimal" | "balanced" | "full";
  maxToolsPerRequest: number;
}

/**
 * Session Compression Configuration (Item 9)
 * Compress old messages in long-running sessions
 * Configurable retention of recent messages
 */
export interface SessionCompressionConfig {
  enabled: boolean;
  compressionThreshold: number; // messages before compression kicks in
  retentionWindow: number; // number of recent messages to keep uncompressed
  summaryStrategy: "abstract" | "keyhighlights" | "combined";
  aggressiveAfterHours: number; // hours, becomes aggressive after this
}

/**
 * Complete optimization configuration
 */
export interface OptimizationConfig {
  level: OptimizationLevel;
  vectorCaching: VectorCachingConfig;
  batchOperations: BatchOperationsConfig;
  responseTruncation: ResponseTruncationConfig;
  toolFiltering: ToolFilteringConfig;
  sessionCompression: SessionCompressionConfig;
}

/**
 * Preset configurations for each optimization level
 */
export const OPTIMIZATION_PRESETS: Record<OptimizationLevel, OptimizationConfig> = {
  [OptimizationLevel.PERFORMANCE_FIRST]: {
    level: OptimizationLevel.PERFORMANCE_FIRST,
    vectorCaching: {
      enabled: false,
      maxVectors: 100,
      ttlMs: 300000,
      similarityThreshold: 0.95,
      useApproximateMatching: false,
    },
    batchOperations: {
      enabled: false,
      maxBatchSize: 1,
      maxWaitMs: 0,
      allowPartialBatches: false,
      groupingStrategy: "model",
    },
    responseTruncation: {
      enabled: false,
      maxTokens: 10000,
      truncateAtSentence: true,
      preserveCodeBlocks: true,
      ellipsisIndicator: "...",
    },
    toolFiltering: {
      enabled: false,
      enableSemanticMatching: false,
      minRelevanceScore: 0,
      exposureStrategy: "full",
      maxToolsPerRequest: 999,
    },
    sessionCompression: {
      enabled: false,
      compressionThreshold: 1000,
      retentionWindow: 50,
      summaryStrategy: "abstract",
      aggressiveAfterHours: 24,
    },
  },

  [OptimizationLevel.BALANCED]: {
    level: OptimizationLevel.BALANCED,
    vectorCaching: {
      enabled: true,
      maxVectors: 500,
      ttlMs: 1800000, // 30 min
      similarityThreshold: 0.85,
      useApproximateMatching: true,
    },
    batchOperations: {
      enabled: true,
      maxBatchSize: 5,
      maxWaitMs: 500,
      allowPartialBatches: true,
      groupingStrategy: "combined",
    },
    responseTruncation: {
      enabled: true,
      maxTokens: 4000,
      truncateAtSentence: true,
      preserveCodeBlocks: true,
      ellipsisIndicator: "...",
    },
    toolFiltering: {
      enabled: true,
      enableSemanticMatching: true,
      minRelevanceScore: 0.6,
      exposureStrategy: "balanced",
      maxToolsPerRequest: 10,
    },
    sessionCompression: {
      enabled: true,
      compressionThreshold: 300,
      retentionWindow: 30,
      summaryStrategy: "keyhighlights",
      aggressiveAfterHours: 2,
    },
  },

  [OptimizationLevel.AGGRESSIVE]: {
    level: OptimizationLevel.AGGRESSIVE,
    vectorCaching: {
      enabled: true,
      maxVectors: 1000,
      ttlMs: 3600000, // 1 hour
      similarityThreshold: 0.75,
      useApproximateMatching: true,
    },
    batchOperations: {
      enabled: true,
      maxBatchSize: 20,
      maxWaitMs: 2000,
      allowPartialBatches: true,
      groupingStrategy: "combined",
    },
    responseTruncation: {
      enabled: true,
      maxTokens: 2000,
      truncateAtSentence: true,
      preserveCodeBlocks: true,
      ellipsisIndicator: "[truncated]",
    },
    toolFiltering: {
      enabled: true,
      enableSemanticMatching: true,
      minRelevanceScore: 0.7,
      exposureStrategy: "minimal",
      maxToolsPerRequest: 5,
    },
    sessionCompression: {
      enabled: true,
      compressionThreshold: 100,
      retentionWindow: 20,
      summaryStrategy: "combined",
      aggressiveAfterHours: 1,
    },
  },
};

/**
 * Get configuration for optimization level
 */
export function getOptimizationConfig(level: OptimizationLevel): OptimizationConfig {
  return OPTIMIZATION_PRESETS[level];
}

/**
 * Calculate estimated cost savings for a configuration
 */
export function estimateSavings(config: OptimizationConfig): {
  vectorCaching: number; // 8%
  batchOperations: number; // 10%
  responseTruncation: number; // 5%
  toolFiltering: number; // 3%
  sessionCompression: number; // 4%
  total: number;
} {
  let vcSavings = 0;
  let batchSavings = 0;
  let truncSavings = 0;
  let toolSavings = 0;
  let compSavings = 0;

  if (config.vectorCaching.enabled) {
    vcSavings = 8;
  }

  if (config.batchOperations.enabled) {
    // Scale savings by batch size (max 10%)
    batchSavings = Math.min((config.batchOperations.maxBatchSize / 20) * 10, 10);
  }

  if (config.responseTruncation.enabled) {
    // Scale by truncation ratio
    const ratio = config.responseTruncation.maxTokens / 4000;
    truncSavings = (1 - ratio) * 5;
  }

  if (config.toolFiltering.enabled) {
    // More aggressive filtering = more savings
    const minRelevanceMultiplier = config.toolFiltering.minRelevanceScore;
    toolSavings = minRelevanceMultiplier * 3;
  }

  if (config.sessionCompression.enabled) {
    // More aggressive compression = more savings
    const compressionRatio = Math.min(config.sessionCompression.retentionWindow / 50, 1);
    compSavings = (1 - compressionRatio) * 4;
  }

  const total = vcSavings + batchSavings + truncSavings + toolSavings + compSavings;

  return {
    vectorCaching: Math.round(vcSavings * 100) / 100,
    batchOperations: Math.round(batchSavings * 100) / 100,
    responseTruncation: Math.round(truncSavings * 100) / 100,
    toolFiltering: Math.round(toolSavings * 100) / 100,
    sessionCompression: Math.round(compSavings * 100) / 100,
    total: Math.round(total * 100) / 100,
  };
}

/**
 * Merge user config with preset
 */
export function mergeConfig(
  level: OptimizationLevel,
  overrides: Partial<OptimizationConfig>,
): OptimizationConfig {
  const preset = OPTIMIZATION_PRESETS[level];

  return {
    level: overrides.level ?? preset.level,
    vectorCaching: { ...preset.vectorCaching, ...overrides.vectorCaching },
    batchOperations: { ...preset.batchOperations, ...overrides.batchOperations },
    responseTruncation: { ...preset.responseTruncation, ...overrides.responseTruncation },
    toolFiltering: { ...preset.toolFiltering, ...overrides.toolFiltering },
    sessionCompression: { ...preset.sessionCompression, ...overrides.sessionCompression },
  };
}
