# Semantic Memory Integration Guide

## Overview

Semantic Memory enables agents to learn across sessions by automatically retrieving relevant past context semantically. Unlike keyword-based search, semantic memory uses vector embeddings to find conceptually similar memories, even if the exact words differ.

**Example:**
- Memory: "I prefer Python over JavaScript"
- Query: "What language should I use?"
- Result: Retrieved because semantically similar, not just keyword match

## Architecture

```
┌─────────────────────────────────────────┐
│     Agent System (system-prompt.ts)     │
│                                         │
│  Calls retrieveContext() on startup    │
│  Injects retrieved context into prompt  │
└──────────────┬──────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│   Semantic Memory (semantic-memory.ts)   │
│                                          │
│  • Initialize vector index               │
│  • Semantic search (query → embeddings)  │
│  • Rank by similarity + recency          │
└──────────────┬───────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│  Memory Indexer (memory-indexer.ts)     │
│                                          │
│  • SQLite storage of embeddings          │
│  • Parse markdown sections               │
│  • Cosine similarity search              │
└──────────────┬───────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│  Vector Embeddings (vector-embeddings.ts)│
│                                          │
│  • Abstract interface                    │
│  • Adapter for OpenClaw providers        │
│  • Similarity metrics (cosine, euclidean)│
└──────────────┬───────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│  OpenClaw Embeddings (embeddings.ts)    │
│                                          │
│  • OpenAI embeddings                     │
│  • Local models (node-llama-cpp)         │
│  • Batch processing                      │
└──────────────────────────────────────────┘
```

## Integration Steps

### 1. System Prompt Integration

In `src/agents/system-prompt.ts`, retrieve semantic context on agent startup:

```typescript
import { SemanticMemory } from "../infra/semantic-memory.js";
import { adaptEmbeddingProvider } from "../memory/embedding-adapter.js";

// During buildAgentSystemPrompt:
if (params.embeddingProvider && params.db) {
  const vectorProvider = adaptEmbeddingProvider(
    params.embeddingProvider,
    1536 // OpenAI default dimensions
  );
  
  const semanticMemory = new SemanticMemory(
    params.db,
    vectorProvider,
    params.workspaceDir
  );
  
  await semanticMemory.initialize();
  
  // Retrieve context based on current session
  const sessionContext = params.heartbeatPrompt || params.extraSystemPrompt || "General context retrieval";
  const context = await semanticMemory.retrieveContext(sessionContext, {
    maxResults: 7,
    minSimilarity: 0.3,
  });
  
  // Inject into prompt
  const semanticSection = semanticMemory.formatContextForPrompt(context);
  // Add semanticSection to buildAgentSystemPrompt output
}
```

### 2. Memory Indexing

Automatically index memory files when they change:

```typescript
// In agent initialization
const semanticMemory = new SemanticMemory(db, vectorProvider, workspaceDir);
await semanticMemory.indexMemoryFiles(workspaceDir);

// Watch for file changes and re-index:
import chokidar from "chokidar";

const watcher = chokidar.watch(
  [
    path.join(workspaceDir, "MEMORY.md"),
    path.join(workspaceDir, "memory"),
  ],
  { ignoreInitial: true }
);

watcher.on("change", async (filePath) => {
  const relPath = path.relative(workspaceDir, filePath);
  if (relPath.endsWith(".md")) {
    await semanticMemory.indexMemoryFiles(workspaceDir);
  }
});
```

### 3. Embedding Provider Selection

Semantic memory works with any OpenClaw embedding provider:

**Option A: OpenAI (Default)**
```typescript
// Uses configured OpenAI API key
const provider = await createEmbeddingProvider({
  config,
  provider: "openai",
  model: "text-embedding-3-small", // or -large
  fallback: "local",
});
```

**Option B: Local Model**
```typescript
const provider = await createEmbeddingProvider({
  config,
  provider: "local",
  model: "hf:ggml-org/embeddinggemma-300M-GGUF/embeddinggemma-300M-Q8_0.gguf",
  fallback: "none",
});
```

**Option C: Auto (Detect)**
```typescript
const provider = await createEmbeddingProvider({
  config,
  provider: "auto", // Uses OpenAI if available, falls back to local
  model: "text-embedding-3-small",
  fallback: "local",
});
```

## Configuration

Semantic memory is configured via OpenClaw config:

```jsonc
{
  "memory": {
    "searchProvider": "auto",
    "embeddingModel": "text-embedding-3-small",
    "semanticMemory": {
      "enabled": true,
      "maxResults": 7,
      "minSimilarity": 0.3,
      "autoIndex": true,
      "indexUpdateIntervalMs": 300000 // 5 minutes
    }
  }
}
```

## Backward Compatibility

Semantic memory is **backward compatible** with existing memory system:

- ✅ Existing `memory_search` tool still works unchanged
- ✅ Automatic retrieval supplements, doesn't replace keyword search
- ✅ Falls back gracefully if embedding provider unavailable
- ✅ Can be disabled via config if needed
- ✅ Existing memory indexes remain functional

## Performance

- **Initialization:** <100ms (async, non-blocking)
- **Search latency:** ~50-200ms (depends on index size)
- **Memory overhead:** ~100 bytes per indexed entry (vector dims + metadata)
- **Startup impact:** Zero (runs in background)

## Testing

### Unit Tests

```typescript
// Test semantic search
const semanticMemory = new SemanticMemory(db, provider, workspaceDir);
await semanticMemory.initialize();

const context = await semanticMemory.retrieveContext(
  "I want to know my language preferences"
);

expect(context.entries).toHaveLength(1);
expect(context.entries[0].text).toContain("Python");
```

### Integration Tests

```typescript
// Full system test: index → search → verify
await semanticMemory.indexMemoryFiles(workspaceDir);

const results = await semanticMemory.retrieveContext(
  "What should I remember about this project?"
);

expect(results.entries.length).toBeGreaterThan(0);
```

## Debugging

Enable semantic memory logging:

```typescript
// In your agent code
if (process.env.DEBUG_SEMANTIC_MEMORY) {
  console.log("Semantic memory context:", context);
  console.log("Index stats:", semanticMemory.getIndexStats());
}
```

## Future Enhancements

- [ ] Relevance feedback loop (user rates retrieved results)
- [ ] Automatic summarization of old memories
- [ ] Multi-modal memory (text + images)
- [ ] Time-based relevance decay (older memories weighted lower)
- [ ] Personalized similarity metrics (learn what user finds relevant)
- [ ] Memory clustering (organize by topics)

## Troubleshooting

### No results returned
- Check `minSimilarity` threshold (default 0.3)
- Verify memory files are indexed (`getIndexStats()`)
- Check embedding provider is available (`isAvailable()`)

### Slow search
- Reduce `maxResults` parameter
- Index files are being re-scanned on every search → batch re-indexing

### Out of memory
- Reduce `maxResults` or increase `minSimilarity`
- Disable semantic memory for low-resource environments

## See Also

- `src/infra/vector-embeddings.ts` - Vector embedding interface
- `src/memory/memory-indexer.ts` - Memory indexing implementation
- `src/infra/semantic-memory.ts` - Main semantic memory module
- `src/memory/embedding-adapter.ts` - OpenClaw embedding adapter
