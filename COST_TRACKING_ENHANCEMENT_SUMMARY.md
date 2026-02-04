# Cost Tracking Enhancement - Implementation Summary

## Overview

Extended OpenClaw's cost tracking system to support conversation-level, monthly, and yearly cost aggregations, while maintaining backward compatibility with existing daily tracking.

## Commits Created

### 1. `f7391e49a` - feat(cost-tracking): add new aggregation types and helper functions

**Files Modified:** `src/infra/session-cost-usage.ts`

**Changes:**

- Added new type exports:
  - `CostUsageMonthlyEntry` - monthly cost breakdown (YYYY-MM format)
  - `CostUsageYearlyEntry` - yearly cost breakdown (YYYY format)
  - `ConversationCostEntry` - per-message cost tracking with timestamp
  - `CostAggregationType` - union type for aggregation modes

- Updated `CostUsageSummary` type:
  - Made `days` and `daily` optional (not all aggregations use them)
  - Added optional `monthly`, `yearly`, and `conversation` arrays
  - Maintains backward compatibility

- Added helper functions:
  - `formatMonthKey()` - formats Date to YYYY-MM
  - `formatYearKey()` - formats Date to YYYY

- Enhanced `ParsedUsageEntry`:
  - Added `messageIndex` tracking for per-message cost identification

- Updated `scanUsageFile()`:
  - Now tracks message index incrementally
  - Enables per-message cost breakdown

### 2. `4ac3d5a18` - feat(cost-tracking): extend gateway endpoint to support aggregation types

**Files Modified:** `src/gateway/server-methods/usage.ts`

**Changes:**

- Added `parseType()` function to extract aggregation type from request parameters
  - Supports: "daily", "monthly", "yearly", "conversation"
  - Defaults to "daily" for backward compatibility

- Updated cache system:
  - Changed from `Map<number, CostUsageCacheEntry>` to `Map<CostUsageCacheKey, CostUsageCacheEntry>`
  - Cache key now includes aggregation type: `${days}:${type}` format
  - Prevents cache collision between different aggregation types

- Extended `loadCostUsageSummaryCached()`:
  - Added `type` parameter to request handler
  - Passes type to `loadCostUsageSummary()`

### 3. `69b475ce5` - feat(cost-tracking): update /usage command to support aggregation modes

**Files Modified:** `src/auto-reply/reply/commands-session.ts`

**Changes:**

- Refactored `handleUsageCommand`:
  - Detects cost-related arguments: "cost", "daily", "monthly", "yearly", "conversation"
  - Delegates cost requests to new `handleCostCommand()` function
  - Maintains existing toggle behavior for "off", "tokens", "full" modes

- Added `handleCostCommand()` function:
  - Determines aggregation type from arguments
  - Loads session costs and aggregated costs (365-day window)
  - Formats and displays results

- Added formatting helpers:
  - `formatDailyBreakdown()` - shows last 10 days
  - `formatMonthlyBreakdown()` - shows all months with costs
  - `formatYearlyBreakdown()` - shows all years with costs
  - `formatConversationBreakdown()` - shows last 20 messages with timestamps

- Output format includes:
  - Session-level total cost and tokens
  - Per-period breakdown (days/months/years/messages)
  - Grand total with token count
  - "(partial)" suffix for entries missing cost data

### 4. `31a7737c3` - docs(cost-tracking): update /usage command definition with new aggregation modes

**Files Modified:** `src/auto-reply/commands-registry.data.ts`

**Changes:**

- Updated command argument choices to include:
  - "off", "tokens", "full" (existing)
  - "cost", "daily", "monthly", "yearly", "conversation" (new)
- Updated description to reflect new cost breakdown options

### 5. `dc207b7ce` - test(cost-tracking): add tests for new aggregation modes

**Files Modified:** `src/infra/session-cost-usage.test.ts`

**Changes:**

- Added 3 comprehensive test cases:

1. **Monthly Aggregation Test**
   - Tests entries across January and February
   - Verifies month grouping (YYYY-MM format)
   - Validates cost and token aggregation per month

2. **Yearly Aggregation Test**
   - Tests entries across 2024 and 2025
   - Verifies year grouping (YYYY format)
   - Validates cross-year aggregation

3. **Conversation Aggregation Test**
   - Tests per-message cost extraction
   - Verifies message indices (0, 1)
   - Validates timestamp preservation
   - Confirms message-level cost accuracy

## Implementation Details

### Aggregation Type Behavior

#### Daily (Default)

```
/usage cost daily
```

- Groups entries by date (YYYY-MM-DD)
- Shows last 10 days of activity
- Use case: Recent activity tracking

#### Monthly

```
/usage cost monthly
```

- Groups entries by month (YYYY-MM)
- Shows all months with data in window
- Use case: Monthly billing review, trend analysis

#### Yearly

```
/usage cost yearly
```

- Groups entries by year (YYYY)
- Shows all years with data in window
- Use case: Annual cost tracking

#### Conversation

```
/usage cost conversation
```

- Per-message breakdown with index and timestamp
- Shows last 20 messages
- Use case: Session-level cost analysis, debugging

### Backward Compatibility

- Existing `/usage` command toggle behavior unchanged (off/tokens/full)
- Daily aggregation is default for cost requests
- Gateway endpoint defaults to "daily" type
- Existing `loadCostUsageSummary()` calls work without type parameter

### Data Flow

```
/usage cost [type] command
    ↓
handleUsageCommand → handleCostCommand
    ↓
loadCostUsageSummary(days: 365, type: string)
    ↓
scanUsageFile → aggregateByType
    ↓
Format and return breakdown
```

## Design Decisions

1. **Optional fields in CostUsageSummary**: Made `days`, `daily`, `monthly`, `yearly`, `conversation` optional to allow different response shapes based on aggregation type.

2. **365-day window for cost requests**: Supports monthly and yearly aggregations across a full year of data (vs. 30 days for daily).

3. **Message index tracking**: Enables per-message cost analysis without modifying session file format.

4. **Backward compatible type parameter**: All existing code continues to work; type parameter is optional with "daily" default.

5. **Separate aggregation logic**: Cleaner implementation with distinct code paths for each aggregation type rather than generic bucketing.

6. **Cache key includes type**: Prevents expensive recomputation when switching between aggregation types.

## Testing Coverage

- Monthly aggregation across multiple months
- Yearly aggregation across multiple years
- Conversation-level extraction with message indices
- Timestamp preservation and accuracy
- Cost aggregation correctness
- Token counting accuracy

## Files Changed Summary

```
 src/auto-reply/commands-registry.data.ts |   4 +-
 src/auto-reply/reply/commands-session.ts | 166 ++++++++++++++++++-----
 src/gateway/server-methods/usage.ts      |  39 ++++--
 src/infra/session-cost-usage.test.ts     | 200 +++++++++++++++++++++++++++-
 src/infra/session-cost-usage.ts          | 217 +++++++++++++++++++++++++++----
```

**Total Changes:** 557 insertions, 69 deletions

## Usage Examples

### View daily costs (last 10 days)

```
/usage cost daily
```

### View monthly breakdown

```
/usage cost monthly
```

### View yearly breakdown

```
/usage cost yearly
```

### View per-message costs (last 20 messages)

```
/usage cost conversation
```

### View session usage footer

```
/usage tokens  # toggles on/off
```

All commands include session total, period breakdown, and grand total.
