# Phase 3 Implementation Guide

**Status:** Ready for Implementation  
**Created:** 2025-02-06  
**Estimated Duration:** 2-3 weeks  
**Team Size:** 2-3 developers

---

## Overview

This document provides detailed implementation steps for the 4 new optimization modules created to reduce token spend and improve performance in OpenClaw.

**⚠️ CRITICAL: Read CRITICAL_CONSTRAINTS.md FIRST**
Before implementing ANY optimization, you MUST read and understand the protected systems:
- AWS integration (do not cache AWS API responses)
- Slack integration (do not compress Slack payloads)
- Session/gateway core (do not modify critical paths)
- Production configuration (do not cache credentials)

**New Modules Created:**
1. `src/infra/http-response-cache.ts` - LRU cache for HTTP responses (⚠️ REQUIRES CAREFUL INTEGRATION)
2. `src/infra/tool-result-cache.ts` - LRU cache for tool results (⚠️ REQUIRES READ-ONLY TOOLS ONLY)
3. `src/infra/performance-metrics.ts` - Metrics collection and reporting (✅ SAFE TO INTEGRATE)
4. `src/infra/message-compressor.ts` - Message payload compression (⚠️ INTERNAL PAYLOADS ONLY)

---

## Implementation Steps

### Phase 3.1: Foundation Setup (Days 1-2)

#### Step 1: Add Modules to Build

The following modules have been created and are ready:
- ✅ `src/infra/http-response-cache.ts` (5.8 KB)
- ✅ `src/infra/tool-result-cache.ts` (5.9 KB)
- ✅ `src/infra/performance-metrics.ts` (11.7 KB)
- ✅ `src/infra/message-compressor.ts` (8.1 KB)

**Action:** Run build to ensure modules compile:
```bash
npm run build
```

#### Step 2: Create Test Files

Create test files for each module:

**`src/infra/http-response-cache.test.ts`**
```typescript
import { HttpResponseCache } from "./http-response-cache.js";

describe("HttpResponseCache", () => {
  let cache: HttpResponseCache;

  beforeEach(() => {
    cache = new HttpResponseCache(10);
  });

  it("should cache and retrieve responses", () => {
    const data = { result: "test" };
    cache.set("http://example.com", data, "api");

    const retrieved = cache.get<typeof data>("http://example.com");
    expect(retrieved).toEqual(data);
  });

  it("should respect TTL expiration", async () => {
    const cache = new HttpResponseCache(10, { api: 100 });
    cache.set("http://example.com", { data: "test" }, "api");

    await new Promise((resolve) => setTimeout(resolve, 150));

    const retrieved = cache.get("http://example.com");
    expect(retrieved).toBeNull();
  });

  it("should evict LRU entries at capacity", () => {
    const cache = new HttpResponseCache(2);
    cache.set("url1", { data: 1 }, "api");
    cache.set("url2", { data: 2 }, "api");
    cache.set("url3", { data: 3 }, "api");

    expect(cache.get("url1")).toBeNull(); // Should be evicted
    expect(cache.get("url2")).toEqual({ data: 2 });
    expect(cache.get("url3")).toEqual({ data: 3 });
  });
});
```

Similar test structure for other modules.

---

### Phase 3.2: Integration with web_search & web_fetch (Days 3-4)

#### ⚠️ CRITICAL WARNINGS BEFORE YOU START

**DO NOT integrate HTTP cache into:**
- AWS API calls (src/infra/aws*, src/channels/plugins/actions/aws*)
- Slack API calls (src/channels/plugins/slack*, authentication endpoints)
- State-dependent APIs (any endpoint that can change between calls)

**DO integrate HTTP cache into:**
- Public web search APIs (immutable responses)
- Public web fetch APIs (with short TTL)
- Read-only HTTP endpoints

**Test before committing:**
```bash
npm test -- src/channels/plugins/slack*.test.ts
npm test -- src/infra/aws*.test.ts
```

#### Step 1: Integrate HTTP Cache into web_search (SAFE)

**File:** `src/gateway/openresponses-http.ts` (or similar)

```typescript
import { getGlobalHttpCache } from "../infra/http-response-cache.js";

export async function searchWeb(query: string, params?: SearchParams): Promise<SearchResult[]> {
  const cache = getGlobalHttpCache();
  
  // Check cache first
  const cached = cache.get<SearchResult[]>(
    "https://api.search.brave.com/search",
    { query, ...params }
  );
  
  if (cached) {
    return cached;
  }

  // Make actual API call
  const results = await performSearch(query, params);

  // Cache result (24 hours for web_search)
  cache.set(
    "https://api.search.brave.com/search",
    results,
    "web_search",
    { query, ...params }
  );

  return results;
}
```

#### Step 2: Integrate HTTP Cache into web_fetch

**File:** Similar to above

```typescript
import { getGlobalHttpCache } from "../infra/http-response-cache.js";

export async function fetchUrl(url: string): Promise<string> {
  const cache = getGlobalHttpCache();
  
  const cached = cache.get<string>(url);
  if (cached) {
    return cached;
  }

  const content = await fetch(url).then(r => r.text());
  
  cache.set(url, content, "web_fetch");
  
  return content;
}
```

**Expected Impact:** 10-15% reduction in API calls, 5-8% token savings

---

### Phase 3.3: Tool Result Caching (Days 5-6)

#### ⚠️ CRITICAL WARNINGS BEFORE YOU START

**DO NOT cache these tools:**
- `exec` - Command execution results change on each call
- `apply-patch` - State-modifying tool
- Any Slack/AWS tools that modify state
- Any tool with side effects
- Any tool that sends messages/notifications

**DO cache these tools ONLY:**
- `read` - Read-only file access
- `web_search` - Immutable search results
- `web_fetch` - Public content, with short TTL
- Other read-only information retrieval

**MUST create tool whitelist BEFORE integration:**
```typescript
const CACHEABLE_TOOLS = new Set([
  'read',
  'web_search',
  'web_fetch',
  // Add only read-only tools here
]);
```

**Test before committing:**
```bash
npm test -- src/agents/pi-tools*.test.ts
npm test -- src/channels/plugins/slack*.test.ts
```

#### Step 1: Integrate Tool Cache into pi-tools.ts (WITH WHITELIST ONLY)

**File:** `src/agents/pi-tools.ts`

```typescript
import { getGlobalToolCache } from "../infra/tool-result-cache.js";

// ⚠️ CRITICAL: Only cache read-only tools
const CACHEABLE_TOOLS = new Set([
  'read',           // ✅ Read-only
  'web_search',     // ✅ Immutable results
  'web_fetch',      // ✅ Public content
  // DO NOT add write/modify tools here
]);

// In tool execution wrapper
async function executeToolWithCache(
  toolName: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const cache = getGlobalToolCache();

  // ✅ SAFE: Only cache read-only tools
  if (CACHEABLE_TOOLS.has(toolName)) {
    const cached = cache.get(toolName, params);
    if (cached !== null) {
      getGlobalMetricsCollector().recordCacheHit("toolResults");
      return cached;
    }
    getGlobalMetricsCollector().recordCacheMiss("toolResults");
  }

  // Execute tool
  const result = await executeTool(toolName, params);

  // ✅ SAFE: Only cache read-only tools
  if (CACHEABLE_TOOLS.has(toolName)) {
    cache.set(toolName, params, result);
  }

  return result;
}
```

#### Step 2: Add Tool-Specific TTL Configuration

```typescript
// In application startup (e.g., main.ts or server initialization)
import { getGlobalToolCache } from "./infra/tool-result-cache.js";

const toolCache = getGlobalToolCache();

// Tools with longer cache (read-only operations)
toolCache.setToolTTL("read", 60 * 60 * 1000); // 1 hour
toolCache.setToolTTL("web_search", 24 * 60 * 60 * 1000); // 24 hours

// Tools with shorter cache (state-dependent)
toolCache.setToolTTL("exec", 5 * 60 * 1000); // 5 minutes
```

**Expected Impact:** 3-5% token savings, 10-20% fewer tool invocations

---

### Phase 3.4: Message Compression (Days 7-8)

#### ⚠️ CRITICAL WARNINGS BEFORE YOU START

**DO NOT compress:**
- Slack message payloads before sending to Slack API
- AWS request bodies before sending to AWS
- Session data or credentials
- Message payloads that have already left internal systems

**DO compress ONLY:**
- Internal message representations (before external dispatch)
- Message metadata and context (non-payload data)
- Compress then decompress before external API calls

**MUST decompress before external dispatch:**
```typescript
// ❌ WRONG: Compress and send directly to Slack
slack.send(compressor.compress(message)); // BROKEN

// ✅ RIGHT: Compress internally, decompress before sending
const compressed = compressor.compress(message);
const decompressed = compressor.decompress(compressed);
slack.send(decompressed); // CORRECT
```

**Test before committing:**
```bash
npm test -- src/channels/plugins/slack*.test.ts
# Manual: Send test Slack message, verify formatting
```

#### Step 1: Integrate Message Compressor (INTERNAL ONLY)

**File:** `src/auto-reply/reply/reply-payloads.ts`

```typescript
import { 
  compressInternalPayload,
  getGlobalMessageCompressor
} from "../../infra/message-compressor.js";

// ⚠️ CRITICAL: Only compress internal representations
export function buildMessagePayload(message: MessageLike): MessagePayload {
  // Build message as normal
  const payload = {
    text: message.text,
    metadata: message.metadata,
    // ... other fields
  };

  // ✅ Only compress INTERNAL representation
  const metrics = getGlobalMessageCompressor().getStats();
  recordCompressionMetrics(metrics);

  // ✅ Return ORIGINAL for external dispatch (NOT compressed)
  return payload;
}

export function serializeInternalPayload(data: unknown): string {
  // ✅ Safe: Compress internal data only
  const compressed = compressInternalPayload(data);
  return JSON.stringify(compressed.compressed);
}
```

#### Step 2: Decompress Before External Dispatch

**File:** `src/gateway/server/ws-connection/message-handler.ts` (or dispatch location)

```typescript
import { getGlobalMessageCompressor } from "../infra/message-compressor.js";

async function dispatchMessage(compressedMsg: unknown) {
  const compressor = getGlobalMessageCompressor();
  
  // ⚠️ CRITICAL: Always decompress before sending to Slack/external
  let messageToSend = compressedMsg;
  
  if (isCompressed(compressedMsg)) {
    messageToSend = compressor.decompress(compressedMsg);
  }
  
  // ✅ Send DECOMPRESSED message to external systems
  if (isSlackMessage(messageToSend)) {
    return slack.send(messageToSend); // Decompressed
  }
  
  if (isAwsMessage(messageToSend)) {
    return aws.send(messageToSend); // Decompressed
  }
  
  return externalDispatch.send(messageToSend);
}
```

**Expected Impact:** 15-20% message size reduction (internal representation only)

---

### Phase 3.5: Performance Metrics Integration (Days 9-10)

#### Step 1: Add Metrics to Hot Paths

**File:** `src/agents/pi-tools.ts`

```typescript
import { getGlobalMetricsCollector } from "../infra/performance-metrics.js";

async function executeTool(toolName: string, params: Record<string, unknown>): Promise<unknown> {
  const metrics = getGlobalMetricsCollector();
  const startTime = performance.now();

  metrics.recordToolInvocation();

  try {
    const result = await runTool(toolName, params);
    return result;
  } finally {
    const duration = performance.now() - startTime;
    metrics.recordLatency("toolInvocation", duration);
  }
}
```

#### Step 2: Add Message Metrics

**File:** `src/auto-reply/dispatch.ts`

```typescript
import { getGlobalMetricsCollector } from "../infra/performance-metrics.js";

async function sendMessage(message: MessagePayload): Promise<void> {
  const metrics = getGlobalMetricsCollector();
  const startTime = performance.now();

  metrics.recordMessageSent();

  try {
    await actualSend(message);
  } finally {
    const duration = performance.now() - startTime;
    metrics.recordLatency("messageSerialization", duration);
  }
}
```

#### Step 3: Add Cost Tracking

**File:** `src/infra/session-cost-usage.ts`

```typescript
import { getGlobalMetricsCollector } from "./performance-metrics.js";

export function recordTokenUsage(usage: NormalizedUsage, costUsd?: number): void {
  const metrics = getGlobalMetricsCollector();

  metrics.recordTokens({
    input: usage.input,
    output: usage.output,
    cacheRead: usage.cache_read,
    cacheWrite: usage.cache_write,
  });

  if (costUsd) {
    metrics.recordCost(costUsd);
  }
}
```

**Expected Impact:** Comprehensive metrics for optimization validation

---

### Phase 3.6: Testing & Validation (Days 11-13)

#### ⚠️ CRITICAL: Test Protected Systems First

**BEFORE running any other tests, verify protected systems still work:**

```bash
# 1. Test Slack integration (MUST PASS)
npm test -- src/channels/plugins/slack*.test.ts
echo "Slack tests: $?"

# 2. Test AWS integration (if applicable, MUST PASS)
npm test -- src/infra/aws*.test.ts
echo "AWS tests: $?"

# 3. Test session management (MUST PASS)
npm test -- src/auto-reply/*.test.ts
echo "Session tests: $?"

# If ANY of above fail, STOP and fix before continuing
```

#### Step 1: Unit Tests (After Protected Systems Pass)

```bash
npm test -- src/infra/http-response-cache.test.ts
npm test -- src/infra/tool-result-cache.test.ts
npm test -- src/infra/message-compressor.test.ts
npm test -- src/infra/performance-metrics.test.ts
```

**Expected:** All tests pass with >90% coverage

**CRITICAL: If protected system tests fail, skip optimization integration**

#### Step 2: Integration Tests

Create integration tests for the complete flow:

**`src/infra/optimization-integration.test.ts`**
```typescript
import { getGlobalHttpCache } from "./http-response-cache.js";
import { getGlobalToolCache } from "./tool-result-cache.js";
import { getGlobalMessageCompressor } from "./message-compressor.js";
import { getGlobalMetricsCollector } from "./performance-metrics.js";

describe("Optimization Integration", () => {
  it("should reduce token count with compression and caching", async () => {
    const httpCache = getGlobalHttpCache();
    const toolCache = getGlobalToolCache();
    const compressor = getGlobalMessageCompressor();
    const metrics = getGlobalMetricsCollector();

    // Simulate message compression
    const message = { text: "test", metadata: { key: "value" } };
    const compressed = compressor.compress(message);

    expect(compressed.compressionRatio).toBeLessThan(1);

    // Verify metrics tracking
    const report = metrics.getReport();
    expect(report.tokens.savedTokens).toBeGreaterThan(0);
  });
});
```

#### Step 2: Critical System Verification

**Manual verification (MUST COMPLETE before proceeding):**

```bash
# 1. Test Slack message send manually
# - Send a test message via Slack interface
# - Verify message formatting is correct
# - Verify message arrives in channel
# - Verify no compression artifacts

# 2. Test AWS operations (if applicable)
# - Execute a test AWS operation
# - Verify response is correct
# - Verify no caching issues
# - Verify no credential leakage

# 3. Check performance
# - Monitor latency of message sends
# - Check memory usage
# - Monitor error rates
# - Verify no increase in failures
```

#### Step 3: Performance Benchmarks

Create benchmark suite to measure improvements:

**`benchmarks/optimization.benchmark.ts`**
```typescript
import { performance } from "node:perf_hooks";
import { getGlobalHttpCache } from "../src/infra/http-response-cache.js";

export async function benchmarkHttpCache(): Promise<void> {
  const cache = getGlobalHttpCache(1000);

  const iterations = 1000;
  const start = performance.now();

  for (let i = 0; i < iterations; i++) {
    cache.set(`url${i}`, { data: i }, "api");
    cache.get(`url${i}`);
  }

  const duration = performance.now() - start;
  console.log(`Cache operations: ${duration}ms for ${iterations * 2} ops`);
  console.log(`Average: ${(duration / (iterations * 2)).toFixed(3)}ms per operation`);
}
```

---

### Phase 3.7: Production Deployment (Days 14-15)

#### Step 1: Pre-Deployment Checklist

- [ ] All modules created and compiling
- [ ] All tests passing (>95% pass rate)
- [ ] Benchmark results collected
- [ ] Code review completed
- [ ] No breaking changes to existing APIs
- [ ] Documentation updated

#### Step 2: Deployment Strategy

**Rolling Deployment:**
1. Deploy to staging environment
2. Monitor metrics for 24 hours
3. Verify 25-40% token reduction claim
4. Deploy to production with feature flags
5. Monitor production metrics for 1 week

**Rollback Plan:**
```bash
# If issues detected, disable caching
export DISABLE_HTTP_CACHE=true
export DISABLE_TOOL_CACHE=true
export DISABLE_MESSAGE_COMPRESSION=true
```

#### Step 3: Monitoring

**Key Metrics to Monitor:**
- Token count per message (baseline vs current)
- Cache hit rates for each cache type
- Latency improvements for hot paths
- API call reduction percentage
- Cost savings (estimated vs actual)

**Alerts to Set Up:**
- Cache eviction rate > 50%
- Cache hit rate < 10%
- Compression ratio > 0.9 (compression not working)
- Latency increase > 10%

---

## Configuration

### Environment Variables

```bash
# Cache configuration
OPENCLAW_HTTP_CACHE_SIZE=1000
OPENCLAW_HTTP_CACHE_TTL_WEB_SEARCH=86400000  # 24 hours
OPENCLAW_HTTP_CACHE_TTL_WEB_FETCH=21600000   # 6 hours
OPENCLAW_HTTP_CACHE_TTL_API=3600000          # 1 hour

# Tool cache configuration
OPENCLAW_TOOL_CACHE_SIZE=500
OPENCLAW_TOOL_CACHE_TTL=1800000              # 30 minutes

# Message compression
OPENCLAW_MESSAGE_CACHE_SIZE=500
OPENCLAW_ENABLE_MESSAGE_COMPRESSION=true
OPENCLAW_ENABLE_PAYLOAD_MINIFICATION=true

# Metrics collection
OPENCLAW_ENABLE_METRICS=true
OPENCLAW_METRICS_REPORT_INTERVAL=3600000     # 1 hour
```

### Configuration File (openclaw.config.json)

```json
{
  "optimization": {
    "cache": {
      "http": {
        "enabled": true,
        "maxSize": 1000,
        "ttl": {
          "web_search": 86400000,
          "web_fetch": 21600000,
          "api": 3600000
        }
      },
      "tools": {
        "enabled": true,
        "maxSize": 500,
        "defaultTTL": 1800000
      },
      "config": {
        "enabled": true,
        "maxSize": 100
      }
    },
    "compression": {
      "enabled": true,
      "minifyInternal": true,
      "deltaEncoding": true,
      "maxCacheSize": 500
    },
    "metrics": {
      "enabled": true,
      "reportInterval": 3600000,
      "verbose": false
    }
  }
}
```

---

## File-by-File Integration Guide

### 1. src/infra/http-response-cache.ts
**Status:** ✅ Created  
**Integration Points:**
- `src/gateway/openresponses-http.ts` - Add to web_search, web_fetch
- `src/infra/fetch.ts` - Add to general fetch calls
- Tests: `src/infra/http-response-cache.test.ts`

### 2. src/infra/tool-result-cache.ts
**Status:** ✅ Created  
**Integration Points:**
- `src/agents/pi-tools.ts` - Wrap tool execution
- `src/agents/pi-embedded-runner/run/attempt.ts` - Cache tool results
- Tests: `src/infra/tool-result-cache.test.ts`

### 3. src/infra/message-compressor.ts
**Status:** ✅ Created  
**Integration Points:**
- `src/auto-reply/reply/reply-payloads.ts` - Compress payloads
- `src/gateway/server/ws-connection/message-handler.ts` - Compress messages
- `src/auto-reply/dispatch.ts` - Before sending
- Tests: `src/infra/message-compressor.test.ts`

### 4. src/infra/performance-metrics.ts
**Status:** ✅ Created  
**Integration Points:**
- `src/agents/pi-tools.ts` - Record tool latency
- `src/auto-reply/dispatch.ts` - Record message latency
- `src/infra/session-cost-usage.ts` - Record token usage
- `src/gateway/openresponses-http.ts` - Record API calls
- Tests: `src/infra/performance-metrics.test.ts`

---

## Validation Checklist

### Pre-Deployment
- [ ] All 4 modules compile without errors
- [ ] Unit tests pass (>95% pass rate)
- [ ] Integration tests pass
- [ ] No regressions in existing functionality
- [ ] Documentation updated
- [ ] Code review approved

### Post-Deployment (Staging)
- [ ] Metrics collecting correctly
- [ ] Cache hit rates > 20% for HTTP cache
- [ ] Tool cache hit rate > 30%
- [ ] Message compression ratio < 0.85
- [ ] No performance regressions
- [ ] Error rates within acceptable range

### Post-Deployment (Production)
- [ ] Token count reduced by 10-20% (first week target)
- [ ] API call reduction > 10%
- [ ] User-facing latency not increased
- [ ] Cache memory usage reasonable
- [ ] No memory leaks
- [ ] Cost reduction on monthly bill

---

## Rollback Procedure

If issues are detected:

```bash
# 1. Disable optimization features
export OPENCLAW_ENABLE_METRICS=false
export OPENCLAW_HTTP_CACHE_SIZE=0
export OPENCLAW_TOOL_CACHE_SIZE=0
export OPENCLAW_ENABLE_MESSAGE_COMPRESSION=false

# 2. Restart services
npm run stop
npm start

# 3. Monitor for stabilization
# Check metrics for 30 minutes

# 4. If stable, investigate root cause
# If not stable, revert code changes
git revert <commit-hash>
npm run build
npm start
```

---

## Performance Optimization Reference

### Expected Improvements

| Component | Before | After | Savings |
|-----------|--------|-------|---------|
| Message Size | 1000 bytes | 850 bytes | 15% |
| Tool Calls | 100 calls | 85 calls | 15% |
| API Calls | 100 calls | 90 calls | 10% |
| Token Count | 10,000 tokens | 7,500 tokens | 25% |
| Cost | $1.00 | $0.75 | 25% |

### Metrics to Track

**Weekly Report Template:**
```
Week of 2025-02-XX

Optimization Metrics:
- Message compression ratio: X%
- HTTP cache hit rate: Y%
- Tool cache hit rate: Z%
- API call reduction: A%
- Token savings: B%

Performance Metrics:
- Avg latency change: C%
- p95 latency change: D%
- p99 latency change: E%

Cost Metrics:
- Estimated savings: $F
- Confidence level: G%
```

---

## Troubleshooting Guide

### Issue: Cache Hit Rate Too Low

**Symptom:** HTTP or tool cache hit rate < 10%

**Causes:**
- Cache TTL too short
- Tool parameters varying too much
- URLs not matching (normalization needed)

**Solution:**
```typescript
// Increase TTL for specific tools
toolCache.setToolTTL("web_search", 48 * 60 * 60 * 1000);

// Normalize parameters before caching
const normalizedParams = normalizeParams(params);
cache.set(toolName, normalizedParams, result);
```

### Issue: Memory Usage High

**Symptom:** Memory grows unbounded during operation

**Causes:**
- Cache size too large
- LRU eviction not working
- Memory leaks in compression module

**Solution:**
```bash
# Reduce cache size
export OPENCLAW_HTTP_CACHE_SIZE=100
export OPENCLAW_TOOL_CACHE_SIZE=50

# Monitor memory with
node --max-old-space-size=2048 src/index.ts
```

### Issue: Message Compression Breaking Functionality

**Symptom:** Messages corrupted or missing fields

**Causes:**
- Minification removing required null fields
- Delta-encoding breaking message semantics
- Missing decompression logic

**Solution:**
```typescript
// Disable delta encoding
compressor.compress(message, false); // isInternalPayload = false

// Verify compression doesn't break semantics
const original = message;
const compressed = compressor.compress(message);
const decompressed = compressor.decompress(compressed);
assert(JSON.stringify(original) === JSON.stringify(decompressed));
```

---

## Next Steps After Implementation

1. **Monitor metrics** for 1-2 weeks
2. **Fine-tune cache sizes** based on actual usage
3. **Implement additional caching** for other APIs
4. **Optimize lazy loading** for context
5. **Implement tool resolution caching**
6. **Add distributed caching** for multi-instance deployment

---

## Success Criteria

✅ **Implementation Complete When:**
- All 4 modules created and integrated
- Tests passing (>95%)
- Metrics showing >20% token reduction
- API calls reduced by >10%
- No user-facing performance degradation
- Production deployment stable for 1 week

---

---

## CRITICAL: What NOT to Do

### ❌ DO NOT Integrate HTTP Cache Into

```typescript
// WRONG: AWS API caching
const awsResult = httpCache.get('dynamodb.query');
await dynamodb.query(); // May return stale data

// WRONG: Slack authentication
const token = httpCache.get('slack.auth.token');
await slack.api.test(); // May use expired token

// WRONG: Session data
const session = httpCache.get(`session/${sessionId}`);
// Session state changes, cache will be wrong
```

### ❌ DO NOT Cache These Tools

```typescript
// WRONG: Caching write operations
const execResult = toolCache.get('exec', { command });
// ❌ Command effects vary, can't cache

// WRONG: State-modifying tools
const patchResult = toolCache.get('apply-patch', params);
// ❌ File system state changes, can't cache

// WRONG: Tools with side effects
const slackResult = toolCache.get('slack-send', params);
// ❌ Same message would be sent multiple times
```

### ❌ DO NOT Compress Before External Dispatch

```typescript
// WRONG: Compress Slack payload before sending
const compressed = compressor.compress(slackPayload);
await slack.send(compressed);
// ❌ Slack receives corrupted/garbled message

// WRONG: Compress AWS request
const compressed = compressor.compress(awsRequest);
await aws.call(compressed);
// ❌ AWS can't parse request

// WRONG: Compress session data
const compressed = compressor.compress(session);
sessionManager.set(compressed);
// ❌ Session state corrupted
```

### ❌ DO NOT Cache Credentials

```typescript
// WRONG: Cache API keys
const apiKey = configCache.get('API_KEY');
// ❌ Credential exposure

// WRONG: Cache tokens
const token = httpCache.get('auth.token');
// ❌ Token may expire, stale data

// WRONG: Cache secrets
const secret = toolCache.get('database.password');
// ❌ Security risk
```

### ❌ DO NOT Modify Protected Code

```typescript
// WRONG: Modify pi-tools.ts core
export function executeToolCore() {
  // ❌ Don't change core logic
}

// WRONG: Modify session loading
function loadSessionState() {
  // ❌ Session must load fresh
}

// WRONG: Modify AWS integration
async function callAwsService() {
  // ❌ Don't cache AWS calls
}

// WRONG: Modify Slack dispatch
async function sendSlackMessage() {
  // ❌ Don't compress before sending
}
```

---

## Common Mistakes & How to Avoid Them

### Mistake 1: Caching Everything

**Problem:** "Let's cache all tool results"

**Why it fails:** Some tools have side effects (exec, apply-patch)

**Solution:** Only cache read-only tools
```typescript
const SAFE_TOOLS = new Set(['read', 'web_search', 'web_fetch']);
if (SAFE_TOOLS.has(toolName)) {
  cache.set(toolName, params, result);
}
```

### Mistake 2: Compressing All Payloads

**Problem:** "Compress all messages to save space"

**Why it fails:** Compressed payloads can't be parsed by external APIs

**Solution:** Only compress internal representations
```typescript
// Compress for storage/analysis
const internal = compressor.compress(msg, true);

// Decompress before sending externally
const toSend = compressor.decompress(internal);
slack.send(toSend);
```

### Mistake 3: Long Cache TTLs for Mutable Data

**Problem:** "Cache web_search results for 7 days"

**Why it fails:** Search results change, users get stale data

**Solution:** Use short TTLs for mutable data
```typescript
cache.updateTTLConfig({
  web_search: 24 * 60 * 60 * 1000,  // 24 hours
  web_fetch: 6 * 60 * 60 * 1000,    // 6 hours
  api: 1 * 60 * 60 * 1000,          // 1 hour
});
```

### Mistake 4: Not Testing Slack/AWS

**Problem:** "Optimize first, test later"

**Why it fails:** Break production systems before catching issues

**Solution:** Always test protected systems first
```bash
npm test -- src/channels/plugins/slack*.test.ts
npm test -- src/infra/aws*.test.ts
# Only proceed if these pass
```

### Mistake 5: Caching Sensitive Data

**Problem:** "Cache user credentials to avoid reloading"

**Why it fails:** Credential exposure, security risk

**Solution:** Never cache credentials
```typescript
// NEVER DO THIS
const credential = cache.get('user.password');

// DO THIS instead
const credential = loadFresh('user.password');
```

---

## Red Flags & When to Stop

### 🚨 Stop if You See These

1. **Modifying aws* files** → You're changing protected code
2. **Compressing Slack payloads** → You'll break Slack messages
3. **Caching session state** → You'll corrupt conversations
4. **Removing existing integrations** → You'll break functionality
5. **Long cache TTLs for APIs** → You'll get stale data
6. **Caching credentials/tokens** → You'll create security risks

### 🚨 Stop if Tests Fail

```bash
# If ANY of these fail, STOP immediately
npm test -- src/channels/plugins/slack*.test.ts
npm test -- src/infra/aws*.test.ts
npm test -- src/auto-reply/*.test.ts

# Don't continue until passing
```

---

*Implementation Guide Created: 2025-02-06*  
*Status: Ready for Development (WITH CRITICAL CONSTRAINTS)*  
*Estimated Team Effort: 60-80 hours*  
*⚠️ READ CRITICAL_CONSTRAINTS.md BEFORE STARTING*
