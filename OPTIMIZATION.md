# Cost Optimization Guide

## Current Setup
- **Model:** Haiku 4.5 ($1/MTok input, $5/MTok output) — already optimal
- **Gateway Optimizations:** Not yet enabled in config
- **Token Budget:** Monitor at ~/estimate-costs.js

## Available Optimizations (from repo)

### 1. Response Truncation
- **Savings:** ~5-10%
- **How:** Smart truncation at sentence boundaries, preserve code blocks
- **My Practice:** Keep responses concise; bullet points over prose; split large responses into threads

### 2. Tool Filtering
- **Savings:** ~3-5%
- **How:** Only expose semantically relevant tools per task
- **My Practice:** Don't load unneeded tools; be explicit about which tools I'm using

### 3. Session Compression
- **Savings:** ~5-15% in long conversations
- **How:** Compress old messages in long-running sessions
- **My Practice:** Summarize past context instead of repeating it; reference prior decisions

### 4. Batch Operations
- **Savings:** ~10%
- **How:** Combine multiple requests into batches
- **My Practice:** Run parallel independent tasks together (via sessions_spawn)

### 5. Vector Caching (Memory)
- **Savings:** ~8%
- **How:** Cache embeddings for semantic similarity
- **My Practice:** Reuse memory recalls; don't re-search the same queries

## Practical Rules for This Session

### Input Optimization (reduce prompt tokens)
1. **Don't repeat context.** Reference previous findings instead of restating them.
2. **Use concise language.** Avoid filler phrases ("I'd be happy to", "Great question!").
3. **Load only what's needed.** If I need file context, read precisely, not the whole directory.
4. **Summarize before acting.** "Here's what I found → here's my plan → executing."

### Output Optimization (reduce response tokens)
1. **Bullet points over prose.** Lists are cheaper than paragraphs.
2. **Code over explanation.** Show, don't tell; let code speak.
3. **Silent when possible.** If a task succeeds quietly, don't narrate every step.
4. **Link instead of repeat.** "See MEMORY.md#Anthropic_Pricing" beats copy-pasting the table.

### Task Optimization
1. **Parallelize independent work.** Use `sessions_spawn` for background tasks.
2. **Cache results.** Store findings in MEMORY.md; reuse them.
3. **Avoid redundant tool calls.** If I just fetched something, don't fetch it again.
4. **Pick the right model.** Haiku is already set; only escalate for complex reasoning.

## Estimated Monthly Savings
- Current usage: ~$0.83/month (226K tokens)
- With optimizations: ~$0.60-0.70/month (20-25% reduction)
- Key win: Session compression on long threads (older thread was 146K tokens)

## Tracking
- Check costs monthly with: `node estimate-costs.js haiku <input> <output>`
- Review token usage in MEMORY.md
- Update this guide as optimizations prove effective
