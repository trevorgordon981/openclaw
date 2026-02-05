# OpenClaw Gateway Optimizations - Deployment Guide

## Overview

This document provides step-by-step instructions for deploying the OpenClaw Gateway Optimizations to your production environment.

## Pre-Deployment Checklist

- [x] All 12 features implemented
- [x] TypeScript compilation verified (0 errors)
- [x] All .d.ts declaration files generated
- [x] No external runtime dependencies (Node.js only)
- [x] Full test coverage setup ready
- [x] Git repository initialized
- [x] Comprehensive documentation created
- [x] Examples and usage patterns documented

## Phase 1: Local Setup

### 1.1 Clone/Initialize Repository

```bash
# If cloning from GitHub
git clone https://github.com/openclaw/gateway-optimizations.git
cd gateway-optimizations

# Or initialize from local source
cd /Users/trevor/.openclaw/workspace
```

### 1.2 Install Dependencies

```bash
npm install
# installs: typescript, @types/node
# Total: ~200MB (dev dependencies only)
```

### 1.3 Verify Build

```bash
npm run typecheck     # Verify TypeScript types
npm run build         # Compile to JavaScript
# Output: dist/src/gateway/*.js and *.d.ts files
```

## Phase 2: Integration

### 2.1 Copy to OpenClaw

```bash
# Option A: Copy entire src/gateway directory
cp -r src/gateway /path/to/openclaw/src/

# Option B: Copy individual features as needed
cp src/gateway/model-tiering.ts /path/to/openclaw/src/gateway/
cp src/gateway/prompt-caching.ts /path/to/openclaw/src/gateway/
# ... etc
```

### 2.2 Update Import Paths

In your OpenClaw code:

```typescript
// Instead of:
// import ModelTieringEngine from './model-tiering';

// Use:
import {
  ModelTieringEngine,
  OptimizationLevel,
  PromptCache,
  // ... other features
} from "./gateway";
```

### 2.3 Configure Optimization Level

```typescript
// In your gateway initialization (e.g., gateway.ts, index.ts)
import { getOptimizationConfig, OptimizationLevel } from "./gateway";

// Choose based on your needs
const config = getOptimizationConfig(OptimizationLevel.BALANCED);

// Or customize
const customConfig = {
  ...getOptimizationConfig(OptimizationLevel.AGGRESSIVE),
  responseTruncation: {
    ...config.responseTruncation,
    maxTokens: 3000, // Custom override
  },
};

export const gatewayConfig = customConfig;
```

## Phase 3: Feature Integration

### 3.1 Model Tiering

**Integration Point:** Request routing before API call

```typescript
import { ModelTieringEngine } from "./gateway";

const modelTiering = new ModelTieringEngine();

// In request handler
const assessment = modelTiering.assessComplexity(
  userInput,
  requestedTools.length,
  estimateTokens(userInput),
);

const selectedModel = assessment.recommendedModel;
// Use selectedModel for Claude API call
```

### 3.2 Prompt Caching

**Integration Point:** System prompt storage

```typescript
import { PromptCache } from "./gateway";

const promptCache = new PromptCache(config.vectorCaching);

// Cache system prompts on startup
for (const [name, prompt] of Object.entries(systemPrompts)) {
  promptCache.set(name, prompt);
}

// In request handler
const cachedPrompt = promptCache.get(systemPromptName);
if (cachedPrompt) {
  // Use cached prompt
} else {
  // Fetch and cache
  promptCache.set(systemPromptName, fetchedPrompt);
}

// Periodic cleanup
setInterval(() => {
  const removed = promptCache.cleanup();
  logger.info(`Cleared ${removed} expired prompts`);
}, 3600000); // Every hour
```

### 3.3 Streaming Responses

**Integration Point:** Response handler

```typescript
import { StreamingHandler } from "./gateway";

// In request handler
const stream = new StreamingHandler(requestId, selectedModel);

stream.on("stream-delta", (chunk) => {
  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
});

stream.start();

// Feed tokens from Claude API
claudeStream.on("data", (token) => {
  stream.write(token);
});

claudeStream.on("end", () => {
  const endChunk = stream.end();
  logger.info(`Request complete: ${stream.getMetadata().tokensProcessed} tokens`);
});

claudeStream.on("error", (err) => {
  stream.error(err);
});
```

### 3.4 Tool Call Validation

**Integration Point:** Tool execution

```typescript
import { ToolValidator } from "./gateway";

const toolValidator = new ToolValidator();

// Register all available tools
for (const tool of availableTools) {
  toolValidator.registerTool(tool.schema);
}

// Before executing tool
const validation = toolValidator.validate({
  toolName: toolCall.name,
  params: toolCall.params,
});

if (!validation.valid) {
  logger.error("Invalid tool call", validation.errors);
  return { error: "Invalid tool parameters", details: validation.errors };
}

// Safe to execute
const result = await executeTool(toolCall.name, toolCall.params);
```

### 3.5 Vector Caching

**Integration Point:** Semantic search/similarity

```typescript
import { VectorCache } from "./gateway";

const vectorCache = new VectorCache(config.vectorCaching.maxVectors, config.vectorCaching.ttlMs);

// Store embeddings
const embedding = await generateEmbedding(text);
vectorCache.set(cacheId, text, embedding);

// Find similar vectors
const similar = vectorCache.findSimilar(queryEmbedding, config.vectorCaching.similarityThreshold);

for (const { entry, similarity } of similar) {
  logger.info(`Found similar: ${entry.text} (${similarity * 100}% match)`);
}

// Cleanup
setInterval(() => vectorCache.cleanup(), 3600000);
```

### 3.6 Batch Operations

**Integration Point:** Request processing

```typescript
import { BatchOperationManager } from "./gateway";

const batchManager = new BatchOperationManager(
  async (requests) => {
    // Process batch of requests together
    return Promise.all(requests.map((req) => processRequest(req)));
  },
  config.batchOperations.maxBatchSize,
  config.batchOperations.maxWaitMs,
);

// In request handler
const result = await batchManager.add(requestId, request);
```

### 3.7 Response Truncation

**Integration Point:** Response generation

```typescript
import { ResponseTruncator } from './gateway';

const truncator = new ResponseTruncator(config.responseTruncation);

// After generating response
let response = generateResponse(...);

if (config.responseTruncation.enabled) {
  const { truncated, wasTruncated } = truncator.truncate(response);
  response = truncated;

  if (wasTruncated) {
    logger.info('Response truncated to save tokens');
  }
}
```

### 3.8 Tool Filtering

**Integration Point:** Tool selection

```typescript
import { ToolFilter } from "./gateway";

const toolFilter = new ToolFilter(config.toolFiltering);
toolFilter.registerTools(availableTools);

// In request handler
const relevantTools = toolFilter.filterForTask(userInput, complexity);

// Use only relevant tools
const toolsForRequest = {
  tools: relevantTools,
  // ... other config
};
```

### 3.9 Session Compression

**Integration Point:** Session management

```typescript
import { SessionCompressor } from "./gateway";

const compressor = new SessionCompressor(
  config.sessionCompression.compressionThreshold,
  config.sessionCompression.retentionWindow,
  config.sessionCompression.summaryStrategy,
);

// Periodically check and compress sessions
setInterval(() => {
  for (const session of activeSessions) {
    const ageHours = (Date.now() - session.createdAt) / 3600000;

    if (compressor.shouldCompress(session.messages, ageHours)) {
      const compressed = compressor.compress(session.messages, ageHours);
      session.messages = compressed.recentMessages;

      logger.info(`Compressed session ${session.id}: ${compressed.compressionRatio}%`);
    }
  }
}, 300000); // Every 5 minutes
```

### 3.10 Rate Limiting

**Integration Point:** Request handling

```typescript
import { RateLimiter } from "./gateway";

const rateLimiter = new RateLimiter(config.rateLimiting);

// In middleware
app.use((req, res, next) => {
  const { allowed, status } = rateLimiter.checkLimit(req.userId);

  res.set("X-RateLimit-Remaining", status.remaining);
  res.set("X-RateLimit-Limit", status.limit);

  if (!allowed) {
    res.set("Retry-After", status.retryAfter);
    return res.status(429).json({
      error: "Rate limit exceeded",
      retryAfter: status.retryAfter,
    });
  }

  next();
});

// Periodic cleanup
setInterval(() => {
  const cleaned = rateLimiter.cleanup();
  logger.debug(`Cleaned up rate limiter: ${cleaned} entries`);
}, 600000); // Every 10 minutes
```

### 3.11 JSON Validation

**Integration Point:** Input validation

```typescript
import { JSONValidator } from "./gateway";

const jsonValidator = new JSONValidator(config.jsonValidation);

// In request handler
if (req.body instanceof Object) {
  const result = jsonValidator.validateObject(req.body);

  if (!result.valid) {
    return res.status(400).json({
      error: "Invalid JSON structure",
      details: result.errors,
    });
  }

  // Use sanitized data
  const safeData = result.data;
}
```

### 3.12 Configuration Management

**Integration Point:** Application initialization

```typescript
import { getOptimizationConfig, OptimizationLevel, mergeConfig, estimateSavings } from "./gateway";

// Load from environment or config file
const optimizationLevel = process.env.OPTIMIZATION_LEVEL || "balanced";

const config = getOptimizationConfig(optimizationLevel as OptimizationLevel);

// Log expected savings
const savings = estimateSavings(config);
console.log(`Configured optimization level: ${optimizationLevel}`);
console.log(`Expected cost savings: ${savings.total}%`);
console.log("Breakdown:", {
  vectorCaching: `${savings.vectorCaching}%`,
  batchOperations: `${savings.batchOperations}%`,
  responseTruncation: `${savings.responseTruncation}%`,
  toolFiltering: `${savings.toolFiltering}%`,
  sessionCompression: `${savings.sessionCompression}%`,
});
```

## Phase 4: Testing

### 4.1 Unit Tests

```typescript
// tests/model-tiering.test.ts
import { ModelTieringEngine, ComplexityLevel } from "../src/gateway";

describe("ModelTieringEngine", () => {
  it("should classify simple tasks correctly", () => {
    const engine = new ModelTieringEngine();
    const assessment = engine.assessComplexity("What is 2+2?", 0, 100);

    expect(assessment.level).toBe(ComplexityLevel.SIMPLE);
    expect(assessment.recommendedModel).toBe("claude-3-5-haiku-20241022");
  });
});
```

### 4.2 Integration Tests

```typescript
// Test full request flow with optimizations
const config = getOptimizationConfig(OptimizationLevel.BALANCED);
const request = {
  input: 'Write a quick hello world',
  tools: ['read', 'write']
};

// Test model tiering
const tiering = new ModelTieringEngine();
const model = tiering.assessComplexity(...).recommendedModel;

// Test tool filtering
const filter = new ToolFilter(config.toolFiltering);
const relevant = filter.filterForTask(request.input, 'simple');

// Test validation
const validator = new ToolValidator();
const validation = validator.validate({
  toolName: 'write',
  params: { file: 'hello.js', content: 'console.log("hi")' }
});
```

### 4.3 Load Testing

```bash
# Test batching performance
k6 run load-tests/batch-operations.js

# Test caching hit rates
k6 run load-tests/prompt-cache.js

# Test rate limiting
k6 run load-tests/rate-limiting.js
```

## Phase 5: Monitoring

### 5.1 Metrics to Track

```typescript
interface OptimizationMetrics {
  modelTiering: {
    simpleRequests: number;
    complexRequests: number;
    estimatedSavings: number;
  };
  promptCaching: {
    cacheHits: number;
    cacheMisses: number;
    hitRate: number;
  };
  streaming: {
    averageFirstTokenLatency: number;
    totalTokensStreamed: number;
  };
  batchOperations: {
    averageBatchSize: number;
    batchedRequests: number;
  };
  responseCompression: {
    totalTokensSaved: number;
    averageTruncationPercent: number;
  };
  toolFiltering: {
    toolsExposedPerRequest: number;
    irrelevantToolCallsBlocked: number;
  };
}
```

### 5.2 Logging

```typescript
import { logger } from "./logger";

// Log optimization decisions
logger.info("Model selection", {
  complexity: assessment.level,
  model: assessment.recommendedModel,
  score: assessment.score,
});

logger.info("Cache operation", {
  operation: "hit",
  key: cacheKey,
  savedCost: 0.0001,
});

logger.info("Optimization stats", {
  level: config.level,
  expectedSavings: savings.total,
  features: {
    modelTiering: true,
    caching: true,
    streaming: true,
  },
});
```

### 5.3 Dashboards

Create dashboards to monitor:

- Cost savings over time
- Cache hit rates
- Model distribution (Haiku/Sonnet/Opus)
- Batch operation efficiency
- Response truncation ratio
- Tool filtering effectiveness

## Phase 6: Rollout Strategy

### 6.1 Shadow Mode (Week 1)

```typescript
// Enable optimizations but don't act on them yet
const enableShadowMode = true;

if (enableShadowMode) {
  const optimizedModel = assessment.recommendedModel;
  logger.info("Shadow mode", {
    selected: selectedModel,
    would_select: optimizedModel,
    savings_estimate: cost_diff,
  });
}
```

### 6.2 Gradual Rollout (Week 2-3)

```typescript
// Roll out to percentage of traffic
const rolloutPercent = 10; // Start at 10%

if (Math.random() * 100 < rolloutPercent) {
  // Use optimized model
} else {
  // Use default model
}
```

### 6.3 Full Deployment (Week 4+)

```typescript
// All traffic uses optimization level
const config = getOptimizationConfig(OptimizationLevel.BALANCED);
```

## Phase 7: Rollback Plan

If issues occur:

```bash
# Disable specific optimization
export OPTIMIZATION_LEVEL=performance-first

# Or revert to commit before integration
git revert <commit-hash>

# Or use feature flags
if (featureFlags.modelTiering.enabled) {
  // Use model tiering
}
```

## Performance Targets

After deployment, verify:

| Metric             | Target    | Measurement                |
| ------------------ | --------- | -------------------------- |
| Cost reduction     | 15-25%    | Compare bills week-on-week |
| Cache hit rate     | 30-40%    | Logs and metrics           |
| Model distribution | 70% Haiku | Request logs               |
| Streaming latency  | <100ms    | First token time           |
| Error rate         | <0.1%     | Error logs                 |

## Troubleshooting

### Issue: Cost not decreasing

**Solution:**

- Verify model tiering is working: check model names in logs
- Check cache hit rate: should be 30-40%
- Verify tool filtering is enabled in config

### Issue: High latency

**Solution:**

- Streaming might have overhead: verify chunk size
- Disable Session Compression if many long sessions
- Check batch operation wait times

### Issue: Cache memory growing

**Solution:**

- Reduce maxEntries in cache config
- Increase cleanup frequency
- Check for memory leaks in integration

## Support

For issues or questions:

1. Check IMPLEMENTATION_SUMMARY.md for detailed feature docs
2. Review README.md for usage examples
3. Check logs for error messages
4. Contact OpenClaw team

## Success Criteria

Deployment is successful when:

- ✅ All 12 features integrated
- ✅ TypeScript compilation passes
- ✅ Cost metrics show 15-25% reduction
- ✅ No increased error rates
- ✅ Performance metrics within targets
- ✅ User satisfaction maintained or improved

---

**Date Completed:** February 4, 2025  
**Version:** 1.0.0  
**Status:** Ready for Deployment
