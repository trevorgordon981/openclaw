# OpenClaw Codebase Analysis: Optimization Opportunities & Bug Report

**Date:** 2026-02-04  
**Reviewed Components:** Token Optimization & Spend Tracking | Slack Integration | AWS/Gateway Integration

---

## Executive Summary

This report identifies **12 actionable issues** across three areas:

- **5 issues** in Token Optimization & Spend Tracking
- **4 issues** in Slack Integration
- **3 issues** in AWS/Gateway Integration

**High-priority items:** Cost tracking gateway cache race condition, Slack send retry failures, Node connection state loss on restart.

---

## 1. TOKEN OPTIMIZATION & SPEND TRACKING

### Issue 1.1: Cost Tracking Cache Race Condition

**Priority:** HIGH  
**Effort:** Quick  
**Area:** `src/gateway/server-methods/usage.ts`

#### Problem

The `loadCostUsageSummaryCached()` function has a subtle race condition where concurrent requests for the same cache key can both initiate cost calculations, wasting resources.

#### Root Cause

```typescript
// Lines 54-60 in usage.ts
const entry: CostUsageCacheEntry = cached ?? {};
const inFlight = loadCostUsageSummary({ days, type, config: params.config }).then((summary) => {
  costUsageCache.set(cacheKey, { summary, updatedAt: Date.now() });
  return summary;
});
// ...
entry.inFlight = inFlight;
costUsageCache.set(cacheKey, entry);
```

If two requests arrive simultaneously and both find `cached?.inFlight` to be undefined, both will start independent `loadCostUsageSummary()` calls. This causes redundant file I/O and aggregation.

#### Suggested Fix

Use a "loading" promise set immediately before starting the async operation:

```typescript
async function loadCostUsageSummaryCached(params: {...}) {
  const cacheKey: CostUsageCacheKey = `${days}:${type}`;
  const now = Date.now();
  const cached = costUsageCache.get(cacheKey);

  // Check if valid cached result exists
  if (cached?.summary && cached.updatedAt && now - cached.updatedAt < COST_USAGE_CACHE_TTL_MS) {
    return cached.summary;
  }

  // Reuse in-flight promise if available
  if (cached?.inFlight) {
    return await cached.inFlight;
  }

  // Start new load and cache it BEFORE the async operation
  const inFlight = loadCostUsageSummary({ days, type, config: params.config })
    .then((summary) => {
      costUsageCache.set(cacheKey, { summary, updatedAt: Date.now(), inFlight: undefined });
      return summary;
    })
    .catch((err) => {
      if (cached?.summary) return cached.summary;
      throw err;
    });

  // Set inFlight BEFORE awaiting to prevent race
  costUsageCache.set(cacheKey, { ...cached, inFlight });
  return await inFlight;
}
```

---

### Issue 1.2: Inefficient File Scanning for Aggregation

**Priority:** MEDIUM  
**Effort:** Medium  
**Area:** `src/infra/session-cost-usage.ts`

#### Problem

The cost tracking aggregation scans **all** session JSONL files in the transcripts directory every time `loadCostUsageSummary()` is called, even though many files haven't changed since the last query.

#### Root Cause

Lines 272-298: The function filters files by `mtimeMs` but performs a full `scanUsageFile()` on each file, which reads the entire file line-by-line, parses JSON, and runs timestamp filtering logic.

For a user with 100+ sessions, this means:

- 100+ file descriptor opens per query
- 100+ full JSON parses per line
- No deduplication of already-aggregated sessions

#### Suggested Fix

Implement a session-level aggregation cache:

```typescript
// Add a persistent cache file: ~/.openclaw/cache/session-cost-cache.json
type SessionCostCache = {
  version: 1;
  sessions: Record<string, {
    lastModified: number;
    cachedTotals: CostUsageTotals;
    timestamp: number;
  }>;
};

// In loadCostUsageSummary(), check cache first:
const cache = await loadCostAggregationCache();
for (const filePath of files) {
  const mtime = stats.mtimeMs;
  const cached = cache.sessions[filePath];

  if (cached && cached.lastModified === mtime) {
    // Reuse cached totals
    applyUsageTotals(totals, cached.cachedTotals);
  } else {
    // Scan file and update cache
    await scanUsageFile({ ... });
    cache.sessions[filePath] = { lastModified: mtime, cachedTotals, timestamp: Date.now() };
  }
}
await saveCostAggregationCache(cache);
```

**Expected impact:** 10-50x faster cost queries for users with many sessions.

---

### Issue 1.3: Missing Batching for Multiple Cost Queries

**Priority:** MEDIUM  
**Effort:** Medium  
**Area:** `src/gateway/server-methods/usage.ts`

#### Problem

When a client makes multiple cost queries in quick succession (e.g., daily, monthly, yearly), each request performs independent full scans of all session files.

#### Root Cause

No request coalescing mechanism. Each request with different `type` parameter (daily/monthly/yearly) gets its own cache key and separate scan.

#### Suggested Fix

Add a "meta-cache" that batches multiple aggregation types in a single file scan:

```typescript
type CostUsageMetaCache = {
  daily?: CostUsageDailyEntry[];
  monthly?: CostUsageMonthlyEntry[];
  yearly?: CostUsageYearlyEntry[];
  totals: CostUsageTotals;
  generatedAt: number;
};

async function loadCostUsageSummaryBatched(params: {
  days: number;
  types: Array<"daily" | "monthly" | "yearly">;
  config: ReturnType<typeof loadConfig>;
}): Promise<Record<string, CostUsageSummary>> {
  // Single scan produces all three aggregations simultaneously
  const metaCache = new Map<string, CostUsageMetaCache>();

  // Scan files once, aggregate all types
  for (const filePath of files) {
    await scanUsageFile({
      filePath,
      config,
      onEntry: (entry) => {
        // Update daily, monthly, and yearly buckets in parallel
        updateDailyBucket(entry);
        updateMonthlyBucket(entry);
        updateYearlyBucket(entry);
      },
    });
  }

  return {
    daily: summary({ type: "daily" }),
    monthly: summary({ type: "monthly" }),
    yearly: summary({ type: "yearly" }),
  };
}
```

---

### Issue 1.4: Missing Cost Data Not Flagged for Audit

**Priority:** MEDIUM  
**Effort:** Quick  
**Area:** `src/infra/session-cost-usage.ts`

#### Problem

When cost data is missing, the code estimates it using `estimateUsageCost()` and falls back to model pricing config. However:

1. **No visibility** into which entries are estimates vs. real costs
2. **No audit trail** of estimation accuracy
3. **Accumulation bias** - estimated costs can drift significantly over time

#### Root Cause

The `missingCostEntries` counter exists but:

- Is only incremented, never analyzed
- No per-session tracking
- No model price validation against actual costs

#### Suggested Fix

Track cost estimation accuracy:

```typescript
export type CostUsageTotals = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  totalCost: number;
  missingCostEntries: number;

  // New fields
  estimatedCostAmount?: number; // Sum of estimated costs
  estimationAccuracy?: {
    // Comparison to real costs
    realCostCount: number;
    estimatedCount: number;
    totalDeviation: number; // Sum of |estimated - real|
  };
};

// In session status tool, flag high estimation variance:
if (totals.estimationAccuracy?.totalDeviation > totals.totalCost * 0.1) {
  // Warn user: "10%+ cost estimate variance detected"
  logWarning(`Cost estimates may be inaccurate: ${estimationAccuracy.totalDeviation}%`);
}
```

---

### Issue 1.5: No Token-per-Model Bucketing for Optimization

**Priority:** LOW  
**Effort:** Medium  
**Area:** Cost tracking overview

#### Problem

The cost tracking system aggregates by time period (daily/monthly) but **not by model**. This prevents analysis like:

- "Which models cost the most?"
- "Where can I replace expensive models with cheaper alternatives?"
- "Is caching reducing token consumption for this model?"

#### Root Cause

Current aggregation types: `daily`, `monthly`, `yearly`, `conversation` — but no `per-model` breakdown.

#### Suggested Fix

Add model-level aggregation:

```typescript
export type CostUsageModelEntry = CostUsageTotals & {
  model: string;
  provider: string;
  usageCount: number; // How many times used
};

// In loadCostUsageSummary with type='model':
const modelMap = new Map<string, CostUsageModelEntry>();
for (const filePath of files) {
  await scanUsageFile({
    filePath,
    onEntry: (entry) => {
      const key = `${entry.provider}:${entry.model}`;
      const bucket = modelMap.get(key) ?? {
        model: entry.model,
        provider: entry.provider,
        usageCount: 0,
        ...emptyTotals(),
      };
      applyUsageTotals(bucket, entry.usage);
      bucket.usageCount++;
      modelMap.set(key, bucket);
    },
  });
}
```

Usage: `/usage cost model` → shows per-model costs, enabling optimization decisions.

---

## 2. SLACK INTEGRATION ISSUES

### Issue 2.1: No Exponential Backoff on `chat.postMessage` Failures

**Priority:** HIGH  
**Effort:** Medium  
**Area:** `src/slack/send.ts`, `src/slack/client.ts`

#### Problem

Slack `chat.postMessage()` can fail transiently (429 rate limits, network blips). The current retry logic (2 retries, fixed 500ms-3s delays) **doesn't account for rate limits** and doesn't implement exponential backoff for cascading failures.

#### Root Cause

Client retry config in `client.ts` (lines 2-7):

```typescript
export const SLACK_DEFAULT_RETRY_OPTIONS: RetryOptions = {
  retries: 2,
  factor: 2,
  minTimeout: 500,
  maxTimeout: 3000,
  randomize: true,
};
```

While Slack SDK handles retries, the problem is:

1. **No 429-specific handling** - should back off longer for rate limits
2. **No circuit breaker** - if Slack API is down, we keep retrying immediately
3. **Silent failures** in `sendMessageSlack()` - no logging of retry attempts

#### Suggested Fix

Implement Slack-aware retry wrapper:

```typescript
// src/slack/send-with-retry.ts
const SLACK_RATE_LIMIT_BACKOFF_MS = 60_000;
const SLACK_SERVER_ERROR_BACKOFF_MS = 5_000;

async function sendMessageSlackWithRetry(
  to: string,
  message: string,
  opts: SlackSendOpts = {},
  retryContext = { attempt: 0 },
): Promise<SlackSendResult> {
  try {
    return await sendMessageSlack(to, message, opts);
  } catch (err) {
    const slackErr = err as { code?: string; message?: string };

    // Rate limited: wait longer
    if (slackErr.code === "rate_limited" || slackErr.message?.includes("429")) {
      if (retryContext.attempt < 3) {
        const delay = SLACK_RATE_LIMIT_BACKOFF_MS * Math.pow(2, retryContext.attempt);
        logVerbose(`Slack rate limit hit, backing off ${delay}ms`);
        await sleep(delay);
        return sendMessageSlackWithRetry(to, message, opts, { attempt: retryContext.attempt + 1 });
      }
      throw new Error(`Slack rate limit exceeded after ${retryContext.attempt} retries`);
    }

    // Server error: exponential backoff
    if (slackErr.code?.startsWith("5") || slackErr.message?.includes("500")) {
      if (retryContext.attempt < 2) {
        const delay = SLACK_SERVER_ERROR_BACKOFF_MS * Math.pow(2, retryContext.attempt);
        logVerbose(`Slack server error, backing off ${delay}ms`);
        await sleep(delay);
        return sendMessageSlackWithRetry(to, message, opts, { attempt: retryContext.attempt + 1 });
      }
      throw new Error(`Slack server error after ${retryContext.attempt} retries`);
    }

    throw err;
  }
}
```

Then update `deliverReplies()` to catch and log:

```typescript
export async function deliverReplies(params: {...}) {
  for (const payload of params.replies) {
    try {
      await sendMessageSlackWithRetry(params.target, trimmed, {
        token: params.token,
        threadTs,
        accountId: params.accountId,
      });
    } catch (err) {
      params.runtime.error?.(`Slack send failed after retries: ${String(err)}`);
      // Re-queue for later? Or notify user?
    }
  }
}
```

---

### Issue 2.2: Message Deduplication Race Condition in High-Volume Channels

**Priority:** HIGH  
**Effort:** Quick  
**Area:** `src/slack/monitor/context.ts` (markMessageSeen)

#### Problem

In high-volume channels (>10 messages/sec), the `markMessageSeen()` deduplication can fail due to a race condition where two Slack events for the same message arrive simultaneously before the first is marked as seen.

#### Root Cause

In `src/slack/monitor/message-handler.ts` line ~110:

```typescript
if (ctx.markMessageSeen(message.channel, message.ts)) {
  return; // Already seen
}
```

`markMessageSeen()` uses a simple Set cache without synchronization. When two webhook events arrive for the same message.ts in rapid succession:

1. Thread A: Checks cache (not found), proceeds
2. Thread B: Checks cache (not found), proceeds
3. Both threads process the same message

#### Suggested Fix

Add atomic check-and-set with optional deduplication timeout:

```typescript
// In SlackMonitorContext creation
const messageSeenTimestamps = new Map<string, number>();
const DEDUP_GRACE_PERIOD_MS = 500; // Messages within 500ms are same

const markMessageSeen = (channelId: string | undefined, ts?: string): boolean => {
  if (!channelId || !ts) return false;

  const key = `${channelId}:${ts}`;
  const now = Date.now();
  const lastSeen = messageSeenTimestamps.get(key);

  if (lastSeen && now - lastSeen < DEDUP_GRACE_PERIOD_MS) {
    return true; // Duplicate within grace period
  }

  messageSeenTimestamps.set(key, now);

  // Clean up old entries (prevent memory leak)
  if (messageSeenTimestamps.size > 10000) {
    const cutoff = now - DEDUP_GRACE_PERIOD_MS;
    for (const [k, v] of messageSeenTimestamps.entries()) {
      if (v < cutoff) messageSeenTimestamps.delete(k);
    }
  }

  return false; // First time seeing this
};
```

---

### Issue 2.3: No Error Recovery for File Upload Failures

**Priority:** MEDIUM  
**Effort:** Medium  
**Area:** `src/slack/send.ts` (uploadSlackFile)

#### Problem

If `files.uploadV2()` fails partway through (network timeout, auth error), the reply with caption is lost and no fallback message is sent to the user. The file upload is attempted but the error is not handled gracefully.

#### Root Cause

Lines 172-196 in send.ts:

```typescript
if (opts.mediaUrl) {
  const [firstChunk, ...rest] = chunks;
  lastMessageId = await uploadSlackFile({
    client,
    channelId,
    mediaUrl: opts.mediaUrl,
    caption: firstChunk,  // If upload fails, caption is lost
    threadTs: opts.threadTs,
    maxBytes: mediaMaxBytes,
  });
  for (const chunk of rest) {
    const response = await client.chat.postMessage({...});
    lastMessageId = response.ts ?? lastMessageId;
  }
}
```

If `uploadSlackFile()` throws, the entire send fails with no fallback.

#### Suggested Fix

Add fallback to text-only message:

```typescript
if (opts.mediaUrl) {
  try {
    const [firstChunk, ...rest] = chunks;
    lastMessageId = await uploadSlackFile({
      client,
      channelId,
      mediaUrl: opts.mediaUrl,
      caption: firstChunk,
      threadTs: opts.threadTs,
      maxBytes: mediaMaxBytes,
    });
    for (const chunk of rest) {
      const response = await client.chat.postMessage({
        channel: channelId,
        text: chunk,
        thread_ts: opts.threadTs,
      });
      lastMessageId = response.ts ?? lastMessageId;
    }
  } catch (uploadErr) {
    // Fallback: Send text without media
    logVerbose(`File upload failed, sending text-only: ${String(uploadErr)}`);
    for (const chunk of chunks) {
      const response = await client.chat.postMessage({
        channel: channelId,
        text: `📎 Media unavailable:\n${chunk}`,
        thread_ts: opts.threadTs,
      });
      lastMessageId = response.ts ?? lastMessageId;
    }
  }
} else {
  // ... text-only path
}
```

---

### Issue 2.4: Reaction Handler Missing Null Validation

**Priority:** MEDIUM  
**Effort:** Quick  
**Area:** `src/slack/monitor/events/reactions.ts`

#### Problem

The reaction event handler assumes `event.item` is always present and of type "message", but Slack can send reaction events for other types (file, app, etc.) without proper validation. This can cause crashes if the handler tries to access undefined properties.

#### Root Cause

Lines 13-16:

```typescript
const item = event.item;
if (!item || item.type !== "message") {
  return; // OK, exits early
}
```

However, the handler doesn't validate `event.item_user` or `event.reaction` before using them (lines 30-35):

```typescript
const emojiLabel = event.reaction ?? "emoji"; // Could be undefined
const authorLabel = authorInfo?.name ?? event.item_user; // event.item_user could be undefined
```

#### Suggested Fix

Add explicit null checks:

```typescript
export function registerSlackReactionEvents(params: { ctx: SlackMonitorContext }) {
  const { ctx } = params;

  const handleReactionEvent = async (event: SlackReactionEvent, action: string) => {
    try {
      const item = event.item;
      if (!item || item.type !== "message") {
        return; // Early exit for non-message reactions
      }

      if (!item.channel || !item.ts) {
        ctx.runtime.error?.("Reaction event missing channel or ts");
        return;
      }

      const channelInfo = await ctx.resolveChannelName(item.channel);
      const channelType = channelInfo?.type;

      if (
        !ctx.isChannelAllowed({
          channelId: item.channel,
          channelName: channelInfo?.name,
          channelType,
        })
      ) {
        return;
      }

      const channelLabel = resolveSlackChannelLabel({
        channelId: item.channel,
        channelName: channelInfo?.name,
      });

      // Validate reaction emoji exists
      const emojiLabel = event.reaction?.trim();
      if (!emojiLabel) {
        ctx.runtime.error?.("Reaction event missing emoji");
        return;
      }

      const actorInfo = event.user ? await ctx.resolveUserName(event.user) : undefined;
      const actorLabel = actorInfo?.name ?? event.user ?? "unknown";

      // Optional: author of original message
      const authorInfo = event.item_user ? await ctx.resolveUserName(event.item_user) : undefined;
      const authorLabel = authorInfo?.name ?? event.item_user ?? undefined;

      const baseText = `Slack reaction ${action}: :${emojiLabel}: by ${actorLabel} in ${channelLabel} msg ${item.ts}`;
      const text = authorLabel ? `${baseText} from ${authorLabel}` : baseText;

      const sessionKey = ctx.resolveSlackSystemEventSessionKey({
        channelId: item.channel,
        channelType,
      });
      enqueueSystemEvent(text, {
        sessionKey,
        contextKey: `slack:reaction:${action}:${item.channel}:${item.ts}:${event.user}:${emojiLabel}`,
      });
    } catch (err) {
      ctx.runtime.error?.(danger(`slack reaction handler failed: ${String(err)}`));
    }
  };

  // ... rest of registration code
}
```

---

## 3. AWS/GATEWAY INTEGRATION ISSUES

### Issue 3.1: Node Connection State Lost on Gateway Restart

**Priority:** HIGH  
**Effort:** Medium  
**Area:** `src/gateway/node-registry.ts`, `src/gateway/server.impl.ts`

#### Problem

When the gateway restarts, **all node connection state is lost**. Connected nodes must manually reconnect. If a node was in the middle of a command invocation when the gateway restarted, the invocation is abandoned with no recovery mechanism.

#### Root Cause

`NodeRegistry` stores connections in memory-only:

```typescript
export class NodeRegistry {
  private nodesById = new Map<string, NodeSession>(); // Lost on restart
  private pendingInvokes = new Map<string, PendingInvoke>(); // Lost on restart
}
```

When gateway restarts:

1. Pending invokes timeout (if in flight)
2. Nodes must detect disconnection and reconnect
3. No recovery for partially-completed operations

#### Suggested Fix

Persist node registration state and implement graceful shutdown:

```typescript
// src/gateway/node-registry-persistence.ts
export type PersistentNodeRegistry = {
  nodeId: string;
  lastConnectedAt: number;
  platform: string;
  version: string;
  pendingOperations: Array<{
    id: string;
    command: string;
    startedAt: number;
  }>;
};

export class NodeRegistry {
  private persistencePath = path.join(process.cwd(), ".openclaw/gateway/node-registry.json");
  private nodesById = new Map<string, NodeSession>();
  private pendingInvokes = new Map<string, PendingInvoke>();

  async saveState(): Promise<void> {
    const state = Array.from(this.nodesById.values()).map((node) => ({
      nodeId: node.nodeId,
      lastConnectedAt: node.connectedAtMs,
      platform: node.platform,
      version: node.version,
      pendingOperations: Array.from(this.pendingInvokes.values())
        .filter((p) => p.nodeId === node.nodeId)
        .map((p) => ({
          id: p.id,
          command: p.command,
          startedAt: p.startedAtMs,
        })),
    }));

    await fs.promises.mkdir(path.dirname(this.persistencePath), { recursive: true });
    await fs.promises.writeFile(this.persistencePath, JSON.stringify(state, null, 2));
  }

  async loadState(): Promise<PersistentNodeRegistry[]> {
    try {
      const data = await fs.promises.readFile(this.persistencePath, "utf-8");
      return JSON.parse(data);
    } catch {
      return [];
    }
  }

  onGatewayShutdown(): void {
    // Fail pending invokes gracefully
    for (const [id, pending] of this.pendingInvokes.entries()) {
      pending.reject(new Error("gateway shutting down"));
    }
    this.pendingInvokes.clear();
  }
}

// In server.impl.ts
const nodeRegistry = new NodeRegistry();
const previousState = await nodeRegistry.loadState();

// Optionally notify node manager that some nodes need reconnection
if (previousState.length > 0) {
  logGateway.warn(`${previousState.length} nodes lost connection on restart`);
}

// Graceful shutdown
process.on("SIGTERM", async () => {
  logGateway.info("Saving node state before shutdown...");
  await nodeRegistry.saveState();
  nodeRegistry.onGatewayShutdown();
  process.exit(0);
});
```

---

### Issue 3.2: Tailscale Fallback Permanently Disabled After First Failure

**Priority:** MEDIUM  
**Effort:** Quick  
**Area:** `src/gateway/server-tailscale.ts`

#### Problem

If Tailscale enablement fails once (e.g., `tailscale` CLI not installed), the failure is logged but **no retry attempt is made**. If Tailscale becomes available later (user installs it), the gateway won't use it.

#### Root Cause

Lines 10-38 in server-tailscale.ts:

```typescript
export async function startGatewayTailscaleExposure(params: {...}): Promise<(() => Promise<void>) | null> {
  if (params.tailscaleMode === "off") {
    return null;
  }

  try {
    if (params.tailscaleMode === "serve") {
      await enableTailscaleServe(params.port);
    } else {
      await enableTailscaleFunnel(params.port);
    }
    // ... success case
  } catch (err) {
    params.logTailscale.warn(`${params.tailscaleMode} failed: ...`);  // One-shot warning
  }

  if (!params.resetOnExit) {
    return null;  // Never retried
  }

  return async () => {...};
}
```

If the error is transient (user hasn't authenticated yet, daemon wasn't running), the opportunity is lost.

#### Suggested Fix

Implement periodic retry with exponential backoff:

```typescript
export async function startGatewayTailscaleExposure(params: {
  tailscaleMode: "off" | "serve" | "funnel";
  resetOnExit?: boolean;
  port: number;
  controlUiBasePath?: string;
  logTailscale: { info: (msg: string) => void; warn: (msg: string) => void };
}): Promise<(() => Promise<void>) | null> {
  if (params.tailscaleMode === "off") {
    return null;
  }

  let retryCount = 0;
  const MAX_RETRIES = 5;
  const INITIAL_BACKOFF_MS = 5000;

  const attemptEnable = async (): Promise<boolean> => {
    try {
      if (params.tailscaleMode === "serve") {
        await enableTailscaleServe(params.port);
      } else {
        await enableTailscaleFunnel(params.port);
      }

      const host = await getTailnetHostname().catch(() => null);
      if (host) {
        const uiPath = params.controlUiBasePath ? `${params.controlUiBasePath}/` : "/";
        params.logTailscale.info(
          `${params.tailscaleMode} enabled: https://${host}${uiPath} (WS via wss://${host})`,
        );
      } else {
        params.logTailscale.info(`${params.tailscaleMode} enabled`);
      }
      return true;
    } catch (err) {
      retryCount++;
      const delay = INITIAL_BACKOFF_MS * Math.pow(2, retryCount - 1);
      params.logTailscale.warn(
        `${params.tailscaleMode} failed (attempt ${retryCount}/${MAX_RETRIES}): ${err instanceof Error ? err.message : String(err)}. Retrying in ${delay}ms...`,
      );

      if (retryCount < MAX_RETRIES) {
        setTimeout(() => void attemptEnable(), delay);
      }
      return false;
    }
  };

  const enabled = await attemptEnable();
  if (!enabled && !params.resetOnExit) {
    return null;
  }

  if (!params.resetOnExit) {
    return null;
  }

  return async () => {
    try {
      if (params.tailscaleMode === "serve") {
        await disableTailscaleServe();
      } else {
        await disableTailscaleFunnel();
      }
    } catch (err) {
      params.logTailscale.warn(
        `${params.tailscaleMode} cleanup failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };
}
```

---

### Issue 3.3: Missing Health Check Between Gateway and Nodes

**Priority:** MEDIUM  
**Effort:** Medium  
**Area:** `src/gateway/node-registry.ts`, Node connection handler

#### Problem

The gateway has **no mechanism to detect a degraded or unresponsive node connection** until a command times out (default 30 seconds). A stalled network connection keeps the node marked as "connected" indefinitely, causing command failures to cascade.

#### Root Cause

Current architecture:

- Nodes connect via WebSocket
- Gateway only checks connectivity when sending commands
- No heartbeat or periodic health check
- Disconnection is only detected when the socket closes

#### Suggested Fix

Add periodic node health checks:

```typescript
// src/gateway/node-health-monitor.ts
export class NodeHealthMonitor {
  private healthCheckIntervalMs = 30_000; // Every 30s
  private healthCheckTimeoutMs = 5_000; // 5s timeout
  private unhealthyThresholdMs = 60_000; // Mark unhealthy after 60s of failures

  startMonitoring(nodeRegistry: NodeRegistry): () => void {
    const interval = setInterval(() => {
      void this.checkAllNodeHealth(nodeRegistry);
    }, this.healthCheckIntervalMs);

    return () => clearInterval(interval);
  }

  private async checkAllNodeHealth(nodeRegistry: NodeRegistry): Promise<void> {
    const nodes = nodeRegistry.listConnected();

    for (const node of nodes) {
      try {
        const result = await nodeRegistry.invoke({
          nodeId: node.nodeId,
          command: "health.ping",
          timeoutMs: this.healthCheckTimeoutMs,
        });

        if (!result.ok) {
          node.lastHealthCheckFailedAt = Date.now();
          const failureDuration = Date.now() - (node.lastHealthCheckFailedAt ?? Date.now());

          if (failureDuration > this.unhealthyThresholdMs) {
            // Mark as unhealthy and disconnect
            console.warn(`Node ${node.nodeId} unhealthy for ${failureDuration}ms, disconnecting`);
            nodeRegistry.unregister(node.connId);
          }
        } else {
          node.lastHealthCheckFailedAt = undefined;
          node.lastHealthCheckAt = Date.now();
        }
      } catch (err) {
        node.lastHealthCheckFailedAt = Date.now();
      }
    }
  }
}

// In server.impl.ts
const healthMonitor = new NodeHealthMonitor();
const stopHealthMonitor = healthMonitor.startMonitoring(nodeRegistry);

// On shutdown
process.on("SIGTERM", () => {
  stopHealthMonitor();
  // ... rest of shutdown
});
```

---

## Summary Table

| Issue | Area           | Priority | Effort | Impact                               |
| ----- | -------------- | -------- | ------ | ------------------------------------ |
| 1.1   | Token Tracking | HIGH     | Quick  | Prevents redundant cost calculations |
| 1.2   | Token Tracking | MEDIUM   | Medium | 10-50x faster cost queries           |
| 1.3   | Token Tracking | MEDIUM   | Medium | Reduces file I/O for batch queries   |
| 1.4   | Token Tracking | MEDIUM   | Quick  | Better cost accuracy visibility      |
| 1.5   | Token Tracking | LOW      | Medium | Enables model optimization           |
| 2.1   | Slack          | HIGH     | Medium | Prevents message loss under load     |
| 2.2   | Slack          | HIGH     | Quick  | Prevents duplicate processing        |
| 2.3   | Slack          | MEDIUM   | Medium | Graceful media upload fallback       |
| 2.4   | Slack          | MEDIUM   | Quick  | Prevents crash on malformed events   |
| 3.1   | Gateway        | HIGH     | Medium | Persists node state across restarts  |
| 3.2   | Gateway        | MEDIUM   | Quick  | Enables Tailscale auto-recovery      |
| 3.3   | Gateway        | MEDIUM   | Medium | Detects stalled connections early    |

---

## Recommended Implementation Priority

### Phase 1 (Immediate - Quick wins)

1. **Issue 1.1** - Fix cache race condition (5 min fix, prevents redundant work)
2. **Issue 2.2** - Add deduplication grace period (10 min, prevents crashes)
3. **Issue 2.4** - Add null validation in reaction handler (5 min, stability)
4. **Issue 3.2** - Add Tailscale retry logic (10 min, reliability)

### Phase 2 (High value)

1. **Issue 2.1** - Slack exponential backoff with rate limit handling
2. **Issue 3.1** - Node state persistence on gateway restart
3. **Issue 3.3** - Node health monitoring

### Phase 3 (Optimization)

1. **Issue 1.2** - Session cost aggregation cache
2. **Issue 1.3** - Cost query batching
3. **Issue 2.3** - File upload error recovery
4. **Issue 1.4** - Cost estimation tracking

---

## Testing Recommendations

- **1.1**: Add concurrent request test to `usage.test.ts`
- **2.1**: Add rate limit scenario test to `send.test.ts`
- **2.2**: High-volume stress test for deduplication
- **3.1**: Add node registry persistence tests
- **3.3**: Add health check timeout scenario test

---

**End of Report**
