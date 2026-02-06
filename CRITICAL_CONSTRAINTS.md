# Critical Constraints for Optimization

**Status:** ⚠️ ACTIVE CONSTRAINTS  
**Updated:** 2025-02-06  
**Severity:** CRITICAL - Do not violate these constraints

---

## Protected Systems (DO NOT MODIFY)

### 1. AWS Integration 🔴
**Files:** `src/channels/plugins/actions/aws*`, `src/infra/aws*`
**Risk Level:** CRITICAL

**What NOT to do:**
- ❌ Cache AWS API responses (they may contain state-dependent data)
- ❌ Modify AWS authentication handling
- ❌ Change cloud connectivity patterns
- ❌ Defer AWS credential loading
- ❌ Compress AWS request/response payloads

**What IS safe:**
- ✅ Add metrics for AWS calls (latency, success/failure)
- ✅ Cache HTTP responses from AWS only with explicit TTL and validation
- ✅ Add performance monitoring to AWS operations

**Implementation Rule:**
```typescript
// UNSAFE - AWS responses are state-dependent
const cached = awsCache.get(params);
if (cached) return cached; // ❌ FORBIDDEN

// SAFE - Metrics only
metrics.recordApiCall();
const result = await aws.call(params);
metrics.recordCost(result.cost);
return result; // ✅ ALLOWED
```

---

### 2. Slack Integration 🔴
**Files:** `src/channels/plugins/slack*`, message routing, authentication
**Risk Level:** CRITICAL

**What NOT to do:**
- ❌ Compress Slack message payloads (will break message formatting)
- ❌ Cache Slack API tokens or auth
- ❌ Modify message routing logic
- ❌ Change Slack message dispatch timing
- ❌ Compress Slack API request bodies

**What IS safe:**
- ✅ Cache Slack metadata (channel lists, user info) with short TTL
- ✅ Add metrics for Slack send operations
- ✅ Compress internal representation of Slack messages (not the payload sent)
- ✅ Add performance monitoring to message dispatch

**Implementation Rule:**
```typescript
// UNSAFE - Slack payload must not be compressed
const compressed = compressor.compress(slackPayload);
await slack.send(compressed); // ❌ FORBIDDEN

// SAFE - Compress internal representation only
const internalPayload = { ...slackPayload };
const metrics = analyzePayload(internalPayload);
await slack.send(slackPayload); // ✅ ALLOWED (sent uncompressed)
```

---

### 3. Session & Gateway Core 🔴
**Files:** `src/auto-reply/*`, `src/agents/pi-tools.ts` core, session management
**Risk Level:** CRITICAL

**What NOT to do:**
- ❌ Cache session state (affects conversation continuity)
- ❌ Modify pi-tools.ts core tool execution logic
- ❌ Lazy-load critical session context
- ❌ Compress session metadata
- ❌ Change message routing in auto-reply

**What IS safe:**
- ✅ Cache tool results for read-only tools only
- ✅ Add metrics to session operations
- ✅ Compress non-critical context (skills, capabilities)
- ✅ Add performance monitoring to tool execution

**Implementation Rule:**
```typescript
// UNSAFE - Session state must not be cached
const cached = sessionCache.get(sessionId);
if (cached) return cached; // ❌ FORBIDDEN

// SAFE - Tool results only for read-only tools
if (toolName === 'read' || toolName === 'web_search') {
  const cached = toolCache.get(toolName, params);
  if (cached) return cached; // ✅ ALLOWED
}
```

---

### 4. Production Configuration 🔴
**Files:** `src/config/*`, environment variables, credentials
**Risk Level:** CRITICAL

**What NOT to do:**
- ❌ Cache credentials or secrets
- ❌ Modify config loading paths
- ❌ Lazy-load critical config values
- ❌ Change environment variable handling
- ❌ Compress config files

**What IS safe:**
- ✅ Cache config schema validation (non-credentials)
- ✅ Add metrics for config load times
- ✅ Compress internal config representation (not files)
- ✅ Add performance monitoring to config operations

**Implementation Rule:**
```typescript
// UNSAFE - Credentials must not be cached
const cached = configCache.get('API_KEY');
if (cached) return cached; // ❌ FORBIDDEN

// SAFE - Cache non-credential config
const cached = configCache.get('APP_MODE');
if (cached) return cached; // ✅ ALLOWED
```

---

## Safe Optimization Zones

### ✅ Message Compression
**Constraints:**
- Only compress INTERNAL message representations
- Never compress Slack/AWS API payloads
- Decompress before sending to external systems
- Add compression/decompression metrics

**Safe Implementation:**
```typescript
// Internal compression OK
function compressInternalMessage(msg) {
  return compressor.compress(msg, true); // isInternalPayload = true
}

// Before sending to Slack
function sendToSlack(compressedMsg) {
  const original = compressor.decompress(compressedMsg);
  return slack.send(original); // Send uncompressed
}
```

---

### ✅ Caching (Non-State-Dependent)
**Constraints:**
- Only cache read-only operations
- Use short TTLs for mutable data (< 5 minutes)
- Never cache: session state, credentials, mutable tool results
- Document all cache keys and TTLs
- Add cache invalidation for state changes

**Safe Implementation:**
```typescript
// Safe caches
const readOnlyCache = {
  web_search: { ttl: 24 * 60 * 60 * 1000 }, // 24h - immutable
  read: { ttl: 60 * 60 * 1000 }, // 1h - rarely changes
  userInfo: { ttl: 5 * 60 * 1000 }, // 5min - can change
};

// Unsafe caches
const unsafeCaches = {
  'exec': 'Tool result changes on each call', // ❌ Don't cache
  'session': 'State affects conversation', // ❌ Don't cache
  'credentials': 'Security risk', // ❌ Don't cache
};
```

---

### ✅ Lazy Loading
**Constraints:**
- Only defer non-critical operations
- Keep critical paths intact
- Add fallback for lazy-loaded resources
- Document all lazy-loaded components

**Safe Implementation:**
```typescript
// Safe lazy loading (non-critical)
const skills = lazyLoad(() => loadSkills()); // OK - non-critical

// Unsafe lazy loading (critical)
// const sessionContext = lazyLoad(() => loadSessionContext()); // ❌ Critical

// Safe fallback pattern
function getSkills() {
  try {
    return skills.get();
  } catch {
    return DEFAULT_SKILLS; // Fallback
  }
}
```

---

### ✅ Performance Monitoring
**Constraints:**
- Add metrics only, don't change behavior
- Use async/non-blocking metrics collection
- Don't expose sensitive data in metrics
- Document all metrics being collected

**Safe Implementation:**
```typescript
// Safe metrics
function recordMetric(name, value) {
  // Async, non-blocking
  setImmediate(() => metrics.record(name, value));
}

// Record publicly safe metrics
recordMetric('tool.latency', duration); // ✅ OK
recordMetric('message.size', payloadSize); // ✅ OK
recordMetric('aws.cost', estimatedCost); // ✅ OK

// Never record
// recordMetric('credentials.length', cred.length); // ❌ Security risk
// recordMetric('token.value', token); // ❌ Security risk
```

---

## Integration Safety Checklist

### Before Integrating HTTP Response Cache

- [ ] Only cache GET requests (not POST/PUT/DELETE)
- [ ] Never cache AWS service calls
- [ ] Never cache authentication/authorization responses
- [ ] Add 'Cache-Control' header checking
- [ ] Document all cached endpoints
- [ ] Add cache invalidation for state changes
- [ ] Test with Slack message sends
- [ ] Verify no credential leakage in cache keys

**File:** `src/infra/http-response-cache.ts`
**Status:** ⚠️ Review before using for AWS/Slack APIs

---

### Before Integrating Tool Result Cache

- [ ] Only cache read-only tools (read, web_search, web_fetch, etc.)
- [ ] Never cache write/modify tools (exec, apply-patch, etc.)
- [ ] Never cache Slack message sends
- [ ] Never cache AWS service modifications
- [ ] Add per-tool whitelist
- [ ] Add cache invalidation triggers
- [ ] Test tool result accuracy after cache hits
- [ ] Verify state-dependent tools not cached

**File:** `src/infra/tool-result-cache.ts`
**Status:** ⚠️ REQUIRES WHITELIST before deployment

---

### Before Integrating Message Compressor

- [ ] Only compress internal message representations
- [ ] Never compress Slack API payloads before sending
- [ ] Never compress AWS request bodies
- [ ] Add decompression before external dispatch
- [ ] Test message formatting not affected
- [ ] Verify Slack message sends work correctly
- [ ] Add compression metrics
- [ ] Document all compression points

**File:** `src/infra/message-compressor.ts`
**Status:** ⚠️ SAFE only for internal payloads

---

### Before Integrating Performance Metrics

- [ ] Don't collect sensitive data (tokens, credentials, keys)
- [ ] Use async metric recording (non-blocking)
- [ ] Don't expose metrics for auth/session data
- [ ] Test metrics don't impact latency
- [ ] Verify no personal data in metrics
- [ ] Add metrics clearing/rotation
- [ ] Test metrics collection with high volume

**File:** `src/infra/performance-metrics.ts`
**Status:** ✅ SAFE to integrate

---

## Protected Code Patterns

### Pattern 1: AWS Integration
```typescript
// PROTECTED - Don't modify
async function callAws(service, params) {
  // Critical: Must execute fresh every time
  // DO NOT cache result
  const result = await awsService.call(params);
  return result;
}

// SAFE: Add metrics
const metrics = getMetricsCollector();
metrics.recordApiCall();
const result = await callAws(...);
metrics.recordCost(result.cost);
```

### Pattern 2: Slack Message Send
```typescript
// PROTECTED - Don't modify
async function sendSlackMessage(channel, message) {
  // Critical: Message format must be preserved
  // DO NOT compress before sending
  const payload = buildSlackPayload(message);
  return slack.send(payload);
}

// SAFE: Add metrics
metrics.recordMessageSent();
const result = await sendSlackMessage(...);
metrics.recordLatency('slack.send', duration);
```

### Pattern 3: Session State
```typescript
// PROTECTED - Don't modify
function getCurrentSession(sessionId) {
  // Critical: Must load fresh state
  // DO NOT cache
  return sessionManager.getSession(sessionId);
}

// SAFE: Add metrics
metrics.recordSessionLoad();
const session = getCurrentSession(sessionId);
```

---

## Pre-Deployment Verification Checklist

### Code Review
- [ ] No AWS API caching added
- [ ] No Slack payload compression
- [ ] No session state caching
- [ ] No credential caching
- [ ] No changes to pi-tools.ts core
- [ ] All new code non-invasive
- [ ] All changes reversible

### Testing
```bash
# 1. Run full test suite
npm test

# 2. Test Slack integration specifically
npm test -- src/channels/plugins/slack*.test.ts

# 3. Test AWS integration (if applicable)
npm test -- src/infra/aws*.test.ts

# 4. Manual verification
# - Send test message to Slack
# - Verify formatting correct
# - Check latency acceptable
# - Review metrics collected
```

### Production Verification
- [ ] Slack messages send correctly
- [ ] AWS operations work (if applicable)
- [ ] No increase in error rate
- [ ] Latency acceptable
- [ ] Memory usage reasonable
- [ ] Metrics collecting
- [ ] No credential exposure

---

## Escalation Procedure

**If unsure whether optimization violates constraints:**

1. **STOP** - Don't integrate
2. **DOCUMENT** - Note the concern
3. **ESCALATE** - Ask maintainer/reviewer
4. **VERIFY** - Get approval before proceeding

**Question to ask:**
- "Will caching this break AWS/Slack integration?"
- "Is this data state-dependent?"
- "Could this expose credentials?"
- "Does this modify pi-tools.ts core logic?"

**Safe answer:** "Skip it and document in audit"

---

## Constraint Violations - DO NOT DO

### ❌ NEVER Cache These

```typescript
// AWS API responses (state-dependent)
awsCache.set('dynamodb.query', result); // ❌

// Slack authentication
slackCache.set('slack.auth', token); // ❌

// Session state
sessionCache.set(sessionId, session); // ❌

// Credentials
credCache.set('api_key', secret); // ❌

// Mutable tool results
toolCache.set('exec', result); // ❌
```

### ❌ NEVER Compress These

```typescript
// Before sending to Slack
slack.send(compressor.compress(payload)); // ❌

// Before sending to AWS
aws.call(compressor.compress(request)); // ❌

// Session data
const compressed = compressor.compress(session); // ❌
```

### ❌ NEVER Modify These

```typescript
// Core tool execution
function executeToolCore() { /* protected */ } // ❌

// Session management
function loadSession() { /* protected */ } // ❌

// AWS integration
function callAwsService() { /* protected */ } // ❌

// Slack message dispatch
function sendToSlack() { /* protected */ } // ❌
```

---

## Safe Implementation Examples

### Example 1: Safe HTTP Cache (Read-Only Endpoint)

```typescript
// ✅ SAFE: Cache HTTP GET response for public API
async function fetchWeatherData(city: string): Promise<Weather> {
  const cache = getHttpCache();
  
  // Check cache
  const cached = cache.get<Weather>(`weather/${city}`);
  if (cached) return cached;
  
  // Fetch
  const weather = await fetch(`https://api.weather.com/${city}`);
  
  // Cache with 6-hour TTL (weather doesn't change frequently)
  cache.set(`weather/${city}`, weather, 'api', {}, 6 * 60 * 60 * 1000);
  
  return weather;
}
```

### Example 2: Safe Tool Cache (Read-Only Tool)

```typescript
// ✅ SAFE: Cache read-only tool results
const READ_ONLY_TOOLS = new Set(['read', 'web_search', 'web_fetch']);

async function executeToolWithCache(name: string, params: any) {
  if (READ_ONLY_TOOLS.has(name)) {
    const cache = getToolCache();
    const cached = cache.get(name, params);
    if (cached) return cached;
  }
  
  const result = await executeTool(name, params);
  
  if (READ_ONLY_TOOLS.has(name)) {
    cache.set(name, params, result);
  }
  
  return result;
}
```

### Example 3: Safe Message Compression (Internal Only)

```typescript
// ✅ SAFE: Compress internal representation, not payload
function buildAndCompressMessage(content: string): {
  original: Message;
  compressed: CompressedMessage;
} {
  const message = {
    text: content,
    timestamp: Date.now(),
    metadata: { /* ... */ }
  };
  
  // Compress for internal use
  const compressed = compressor.compress(message, true);
  
  // When sending externally, use original
  return { original: message, compressed };
}

async function sendMessage(msg: Message) {
  // Always send original, never compressed
  await slack.send(msg.original);
}
```

### Example 4: Safe Performance Metrics (Non-Blocking)

```typescript
// ✅ SAFE: Non-blocking metrics collection
async function recordMetricsAsync(operation: string, duration: number) {
  // Use setImmediate to avoid blocking
  setImmediate(() => {
    const metrics = getMetricsCollector();
    metrics.recordLatency(operation, duration);
  });
}

async function executeWithMetrics(fn: () => Promise<void>) {
  const start = performance.now();
  try {
    await fn();
  } finally {
    const duration = performance.now() - start;
    recordMetricsAsync('operation', duration); // Non-blocking
  }
}
```

---

## Documentation Requirements

### For Each Optimization Component

1. **Safety Assessment** - Is it safe?
2. **Protected Resources** - What could it break?
3. **Constraints** - What restrictions apply?
4. **Integration Points** - Where can it be used?
5. **Testing** - How to verify safety?
6. **Rollback** - How to undo if issues?

---

## Maintenance & Monitoring

### Weekly Safety Checks

```bash
# 1. Review metrics for unexpected patterns
npm run metrics:report

# 2. Check cache hit rates (should be reasonable, not 0 or 100)
npm run cache:stats

# 3. Monitor error rates
npm run errors:report

# 4. Verify AWS operations still working
npm test -- src/infra/aws*.test.ts

# 5. Verify Slack integration still working
npm test -- src/channels/plugins/slack*.test.ts
```

### Monthly Safety Audit

- [ ] Review all cache configurations
- [ ] Check TTL appropriateness
- [ ] Verify no credential leakage
- [ ] Review metric collection
- [ ] Check AWS/Slack integration health
- [ ] Update this constraint document if needed

---

## Questions Before Implementing

Before integrating any optimization module, answer these questions:

1. **Does this modify AWS integration?** → If yes, STOP
2. **Does this modify Slack integration?** → If yes, STOP
3. **Does this cache state-dependent data?** → If yes, STOP
4. **Does this compress data before sending to external systems?** → If yes, STOP
5. **Does this modify session management?** → If yes, STOP
6. **Does this cache credentials?** → If yes, STOP

**If answer to any is YES:** Don't integrate, document as skipped

---

## Emergency Rollback

If optimization causes issues:

```bash
# 1. Disable all optimization features
export OPENCLAW_ENABLE_HTTP_CACHE=false
export OPENCLAW_ENABLE_TOOL_CACHE=false
export OPENCLAW_ENABLE_MESSAGE_COMPRESSION=false
export OPENCLAW_ENABLE_METRICS=false

# 2. Restart services
npm stop
npm start

# 3. Verify AWS/Slack working
npm test -- src/infra/aws*.test.ts src/channels/plugins/slack*.test.ts

# 4. If still broken, revert code
git revert <commit-hash>
npm run build
npm start
```

---

## Contact & Escalation

**If constraint violation discovered:**
- Document finding
- Note severity (Critical/High/Medium)
- Recommend rollback
- Escalate to maintainer
- Do not continue integration

---

*Critical Constraints Document*  
*Version: 1.0*  
*Updated: 2025-02-06*  
*Status: ACTIVE*
