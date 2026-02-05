# Cost Tracking Guide

Complete guide to OpenClaw's cost tracking and monitoring system.

## Overview

OpenClaw tracks all API costs automatically, providing real-time cost visibility across sessions, models, and time periods.

**Key Features:**

- ✅ Real-time cost calculation from token usage
- ✅ Multi-provider support (Anthropic, Google, extensible)
- ✅ Session-level and aggregate cost tracking
- ✅ Daily, monthly, yearly, and per-message cost breakdowns
- ✅ Cost efficiency metrics and ROI calculation
- ✅ Budget monitoring and alerts
- ✅ Gateway API for programmatic access

## Quick Start

### View Session Costs

```bash
# Show session status with cost
/status
```

Output example:

```
🧠 Model: google/gemini-2.0-flash
🧮 Tokens: 2.5k in / 856 out · 💵 Cost: $0.0051
```

### View Cost Breakdown

```bash
# Daily breakdown (last 10 days)
/usage cost daily

# Monthly costs
/usage cost monthly

# Yearly costs
/usage cost yearly

# Per-message costs
/usage cost conversation
```

## Architecture

### Cost Tracking Pipeline

```
API Response (with token usage)
    ↓
Extract usage from message
    ↓
Resolve model pricing
    ↓
Calculate cost: (input × input_price + output × output_price) / 1,000,000
    ↓
Store in session transcript (.jsonl file)
    ↓
Aggregate by time period (daily/monthly/yearly)
    ↓
Display or export
```

### Data Flow

1. **Collection**: Usage tracked at message level in session transcripts
2. **Enrichment**: Pricing attached to models during catalog loading
3. **Calculation**: Cost computed from tokens and pricing
4. **Aggregation**: Costs grouped by time period or session
5. **Reporting**: Displayed via status commands or gateway API

## Pricing Configuration

### Supported Models

#### Anthropic Claude

- **claude-haiku-4-5-20251001**: $0.80 / $4.00 (input/output per 1M tokens)
- **claude-sonnet-4-5**: $3 / $15
- **claude-opus-4-5**: $15 / $75
- Plus 12+ additional Claude versions

#### Google Gemini

- **gemini-2.0-flash**: $0.075 / $0.30 (fastest, cheapest)
- **gemini-1.5-pro**: $1.25 / $5
- **gemini-1.5-flash**: $0.075 / $0.30
- Plus preview versions (3.x)

**Cache Pricing** (for supported models):

- Cache Read: 10% of input token price
- Cache Write: 25% of input token price

### Adding New Provider Pricing

**1. Create pricing module:**

```typescript
// src/agents/openai-models-pricing.ts
export const OPENAI_MODEL_PRICING: Record<string, ModelCostConfig> = {
  "gpt-4o": {
    input: 5,
    output: 15,
    cacheRead: 0.5,
    cacheWrite: 1.25,
  },
  // ... more models
};

export function getOpenAIModelPricing(modelId: string): ModelCostConfig | undefined {
  // Implementation
}
```

**2. Update enrichment system:**

```typescript
// src/agents/model-pricing-enrichment.ts
if (normalizedProvider === "openai") {
  return getOpenAIModelPricing(normalizedModelId);
}
```

**3. Models automatically enriched during discovery**

### Override Pricing in Config

In your config file (e.g., `~/.openclaw/config.yaml`):

```yaml
models:
  providers:
    anthropic:
      models:
        - id: claude-opus-4-5
          cost:
            input: 20 # Custom override
            output: 100
            cacheRead: 2
            cacheWrite: 5
```

## Cost Metrics

### Session Status

Shows current session cost in real-time:

```
💵 Cost: $0.0051    # Total cost for this session
🧮 Tokens: 2.5k in / 856 out  # Token breakdown
```

### Daily Report

Last 10 days with daily costs:

```
Daily Cost Breakdown (last 10 days):
2026-02-04: $0.0145 (5.2k tokens)
2026-02-03: $0.0089 (3.1k tokens)
2026-02-02: $0.0234 (8.5k tokens)
...
TOTAL: $0.1024 (31.2k tokens)
```

### Monthly Analysis

Monthly costs and trends:

```
Monthly Cost Breakdown:
2026-02: $0.3245 (125k tokens)
2026-01: $0.8902 (340k tokens)
2025-12: $0.5671 (215k tokens)
...
TOTAL: $2.8923 (1.2M tokens)
```

### Efficiency Metrics

```
Cost per 1M tokens: $1.25
Cost per session: $0.015
Tokens per dollar: 800,000
Sessions per dollar: 67
```

## Gateway API

### Get Current Costs

```bash
# Daily costs (last 30 days)
curl http://localhost:8080/usage/cost?days=30&type=daily

# Monthly breakdown
curl http://localhost:8080/usage/cost?days=365&type=monthly

# Yearly analysis
curl http://localhost:8080/usage/cost?days=365&type=yearly

# Per-session costs
curl http://localhost:8080/usage/cost?type=conversation&sessionId=abc123
```

### Response Format

```json
{
  "updatedAt": 1675123456789,
  "daily": [
    {
      "date": "2026-02-04",
      "input": 5200,
      "output": 1850,
      "totalTokens": 7050,
      "totalCost": 0.0145,
      "missingCostEntries": 0
    }
  ],
  "totals": {
    "input": 312000,
    "output": 89000,
    "totalTokens": 401000,
    "totalCost": 0.1024,
    "missingCostEntries": 0
  }
}
```

## Cost Monitoring

### Monitor Spending

```typescript
import { assessCostStatus } from "./src/infra/cost-metrics";

const status = assessCostStatus({
  dailySpend: 0.5,
  monthlyBudget: 100,
  dailyBudget: 5,
});

// Returns: "healthy" | "warning" | "critical"
if (status === "critical") {
  // Send alert
}
```

### Estimate Costs

```typescript
import { estimateConversationCost } from "./src/infra/cost-metrics";

const estimate = estimateConversationCost({
  estimatedInputTokens: 2000,
  estimatedOutputTokens: 500,
  estimatedTurns: 10,
  modelCostPerMillionInput: 0.075, // Gemini 2.0 Flash
  modelCostPerMillionOutput: 0.3,
});

console.log(`Estimated cost: $${estimate.estimatedTotalCost.toFixed(4)}`);
console.log(`Cost range: ${estimate.costRange.low}–${estimate.costRange.high}`);
```

### Calculate ROI

```typescript
import { calculateCostSavingsROI } from "./src/infra/cost-metrics";

const roi = calculateCostSavingsROI({
  previousMonthlyCost: 100, // Old model (e.g., Opus)
  newMonthlyCost: 20, // New model (e.g., Gemini)
  implementationCost: 50, // Migration effort
  months: 12,
});

console.log(`ROI: ${roi.roi.toFixed(0)}%`);
console.log(`Payback period: ${roi.paybackMonths.toFixed(1)} months`);
```

## Cost Optimization

### Model Selection

**Cheapest to Most Expensive:**

| Model            | Cost         | Speed  | Use Case                      |
| ---------------- | ------------ | ------ | ----------------------------- |
| gemini-2.0-flash | $0.075/$0.30 | ⚡⚡⚡ | Fast, cheap general-purpose   |
| gemini-1.5-flash | $0.075/$0.30 | ⚡⚡⚡ | Same, with 1M context         |
| claude-haiku     | $0.80/$4.00  | ⚡⚡   | Small tasks, cost-sensitive   |
| gemini-1.5-pro   | $1.25/$5.00  | ⚡⚡   | Complex reasoning, 1M context |
| claude-sonnet    | $3/$15       | ⚡⚡   | Balanced capability/cost      |
| claude-opus      | $15/$75      | ⚡     | Most capable, highest cost    |

**Cost Comparison (1K input, 500 output):**

- Gemini 2.0 Flash: **$0.0028** ← Cheapest
- Claude Haiku: $0.0028 (equivalent)
- Claude Sonnet: $0.0045
- Claude Opus: $0.0195

### Strategy Examples

**1. Cost-First (Minimal Spend)**

```
Default: google/gemini-2.0-flash ($0.075/$0.30)
Expected: $50–100/month per session
```

**2. Balanced (Quality + Cost)**

```
Default: google/gemini-1.5-pro ($1.25/$5)
Fallback: gemini-2.0-flash
Expected: $500–1000/month per session
```

**3. Quality-First (Performance)**

```
Default: anthropic/claude-opus-4-5 ($15/$75)
Fallback: claude-sonnet-4-5
Expected: $2000–5000/month per session
```

### Optimization Tips

1. **Use caching**: Enable prompt caching for repeated context
   - Saves 90% on cache hits (10% cache read cost)
2. **Batch operations**: Group similar requests
   - Reduces model switching overhead
3. **Stream responses**: Don't wait for full completion
   - Stop early, pay only for tokens used
4. **Model switching**: Use cheaper models for classification
   - Gemini 2.0 Flash for triage, Opus for complex reasoning
5. **Context compression**: Summarize long context
   - Fewer input tokens = lower cost
6. **Monitor by session**: Track expensive sessions
   - Cancel or optimize high-cost conversations

## Troubleshooting

### Costs Not Showing

**Problem**: Cost line missing from session status

```
Solution: Model pricing not found
1. Check model is in pricing database
2. Verify model ID format: provider/model-id
3. Check resolveModelCostConfig() result
```

**Problem**: "missingCostEntries" in cost summary

```
Solution: API didn't return usage data
1. Check model supports usage tracking
2. Verify API response includes token counts
3. Check session transcript for usage field
```

### Unexpected High Costs

**Problem**: Cost spike in cost metrics

```
Solution: Debug token usage
1. Check input tokens for context size
2. Verify output tokens are reasonable
3. Look for repeated expensive operations
4. Check for model fallback events
```

## Cost Examples

### Typical Conversation

**Scenario**: 5-turn conversation with Gemini 2.0 Flash

```
Turn 1: 500 input, 150 output = $0.0006
Turn 2: 650 input, 200 output = $0.0008
Turn 3: 600 input, 180 output = $0.0007
Turn 4: 700 input, 220 output = $0.0008
Turn 5: 800 input, 250 output = $0.0009
─────────────────────────────
Total:  3,650 input, 1,000 output = $0.0038
```

### Daily Session Cost

**Scenario**: 10 sessions per day, 3-turn average

```
10 sessions × $0.0038/session = $0.038/day
$0.038 × 30 days = $1.14/month
```

### Monthly at Scale

**Scenario**: 100 concurrent users, 10 sessions/user/day

```
100 users × 10 sessions × $0.0038 = $3.80/day
$3.80 × 30 = $114/month
```

## Best Practices

1. **Monitor continuously**: Check cost metrics regularly
2. **Set budgets**: Use dailyBudget/monthlyBudget settings
3. **Alert on changes**: Configure cost threshold alerts
4. **Track by model**: Know which models cost most
5. **Optimize early**: Fix expensive patterns quickly
6. **Review monthly**: Analyze cost trends and adjust
7. **Document assumptions**: Keep pricing current
8. **Test with cheap models**: Use Gemini 2.0 Flash for dev

## Related Commands

```bash
# View session status with cost
/status

# View cost breakdown by time period
/usage cost daily
/usage cost monthly
/usage cost yearly
/usage cost conversation

# Switch model (changes cost)
/model gemini-2.0-flash

# View token usage
/usage tokens

# View all usage
/usage full
```

## Further Reading

- [Cost Tracking Implementation Summary](COST_TRACKING_IMPLEMENTATION_SUMMARY.md)
- Model Pricing: `src/agents/anthropic-models-pricing.ts`, `gemini-models-pricing.ts`
- Cost Metrics: `src/infra/cost-metrics.ts`
- Session Tracking: `src/infra/session-cost-usage.ts`
- Gateway API: `src/gateway/server-methods/usage.ts`

## Support

For cost tracking issues:

1. Check session transcript for usage entries
2. Verify model pricing is configured
3. Review gateway logs for API responses
4. Compare to official provider pricing
5. Open issue with cost metrics example
