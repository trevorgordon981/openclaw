/**
 * OpenClaw Gateway Optimizations - All Features
 *
 * This module exports all 12 optimization features:
 * 1. Model Tiering - Route tasks to optimal Claude models
 * 2. Prompt Caching - Cache system prompts and context
 * 3. Streaming Responses - Stream tokens instead of waiting for completion
 * 4. Tool Call Validation - Validate tool calls before execution
 * 5. Vector Caching - Cache embeddings for semantic similarity
 * 6. Batch Operations - Combine multiple requests into batches
 * 7. Response Truncation - Smart truncation at sentence boundaries
 * 8. Tool Filtering - Only expose relevant tools per task
 * 9. Session Compression - Compress old messages in long-running sessions
 * 10. Rate Limiting - Per-minute rate limits with burst protection
 * 11. JSON Validation - Pre-validate JSON before processing
 * 12. Config-Driven Optimization Levels - Aggressive/Balanced/Performance-First
 */

// Feature 1: Model Tiering
export { ComplexityLevel, ComplexityAssessment, ModelTieringEngine } from "./model-tiering";

// Feature 2: Prompt Caching
export { CacheEntry, PromptCacheConfig, PromptCache } from "./prompt-caching";

// Feature 3: Streaming Responses
export {
  StreamConfig,
  StreamChunk,
  StreamMetadata,
  StreamingHandler,
  streamToSSE,
} from "./streaming-handler";

// Feature 4: Tool Call Validation
export {
  ToolSchema,
  ParameterDefinition,
  ToolCall,
  ValidationResult,
  ValidationError,
  ToolValidator,
} from "./tool-validator";

// Feature 5: Vector Caching
export { VectorCacheEntry, VectorCache } from "./vector-cache";

// Feature 6: Batch Operations
export {
  BatchRequest,
  BatchResult,
  BatchProcessor,
  BatchOperationManager,
} from "./batch-operations";

// Feature 7: Response Truncation
export { TruncationOptions, ResponseTruncator } from "./response-truncation";

// Feature 8: Tool Filtering
export { Tool, FilteringStrategy, ToolFilter } from "./tool-filtering";

// Feature 9: Session Compression
export { Message, CompressedSession, SessionCompressor } from "./session-compression";

// Feature 10: Rate Limiting
export { RateLimitConfig, RateLimitStatus, RateLimiter } from "./rate-limiter";

// Feature 11: JSON Validation
export {
  JSONValidationConfig,
  ValidationError as JSONValidationError,
  JSONValidator,
} from "./json-validator";

// Feature 12: Config-Driven Optimization
export {
  OptimizationLevel,
  VectorCachingConfig,
  BatchOperationsConfig,
  ResponseTruncationConfig,
  ToolFilteringConfig,
  SessionCompressionConfig,
  OptimizationConfig,
  OPTIMIZATION_PRESETS,
  getOptimizationConfig,
  estimateSavings,
  mergeConfig,
} from "./gateway-optimization.config";
