# Semantic Memory - Usage Examples

## Quick Start

### Basic Usage

```typescript
import { SemanticMemory } from "./src/infra/semantic-memory.js";
import { adaptEmbeddingProvider } from "./src/memory/embedding-adapter.js";
import { createEmbeddingProvider } from "./src/memory/embeddings.js";
import Database from "better-sqlite3";

// 1. Setup embedding provider
const embeddingProvider = await createEmbeddingProvider({
  config,
  provider: "auto", // OpenAI or local
  model: "text-embedding-3-small",
  fallback: "local",
});

// 2. Create semantic memory
const vectorProvider = adaptEmbeddingProvider(embeddingProvider, 1536);
const db = new Database(":memory:");
const semanticMemory = new SemanticMemory(db, vectorProvider, workspaceDir);

// 3. Initialize (async, non-blocking)
await semanticMemory.initialize();
await semanticMemory.indexMemoryFiles(workspaceDir);

// 4. Retrieve context when needed
const context = await semanticMemory.retrieveContext(
  "How should I structure my TypeScript project?"
);

// 5. Format for display
const formatted = semanticMemory.formatContextForPrompt(context);
console.log(formatted);
```

## Example 1: Agent System Prompt Integration

```typescript
// In src/agents/system-prompt.ts

export async function buildAgentSystemPrompt(params: {
  workspaceDir: string;
  db?: DatabaseSync;
  embeddingProvider?: EmbeddingProvider;
  heartbeatPrompt?: string;
  // ... other params
}): Promise<string> {
  const lines: string[] = [];
  
  // ... existing code ...
  
  // Add semantic memory context
  if (params.db && params.embeddingProvider && params.workspaceDir) {
    try {
      const vectorProvider = adaptEmbeddingProvider(
        params.embeddingProvider,
        1536
      );
      
      const semanticMemory = new SemanticMemory(
        params.db,
        vectorProvider,
        params.workspaceDir
      );
      
      // Initialize (async, non-blocking)
      semanticMemory.initialize().catch(err => {
        console.warn("Semantic memory initialization failed:", err);
      });
      
      // Retrieve relevant context
      const sessionQuery = params.heartbeatPrompt || "General session context";
      const memoryContext = await semanticMemory.retrieveContext(
        sessionQuery,
        { maxResults: 7, minSimilarity: 0.3 }
      );
      
      // Format and inject
      if (memoryContext.entries.length > 0) {
        const semanticSection = semanticMemory.formatContextForPrompt(
          memoryContext,
          20 // max lines
        );
        
        lines.push("## Semantic Memory (Auto-Retrieved)");
        lines.push(semanticSection);
        lines.push("");
      }
    } catch (error) {
      console.warn("Semantic memory retrieval failed:", error);
      // Falls back gracefully - system still works
    }
  }
  
  // ... rest of code ...
  
  return lines.join("\n");
}
```

## Example 2: File System Watching

```typescript
// Watch for memory changes and re-index

import chokidar from "chokidar";
import path from "path";

const semanticMemory = new SemanticMemory(db, vectorProvider, workspaceDir);
await semanticMemory.initialize();

// Initial index
await semanticMemory.indexMemoryFiles(workspaceDir);

// Watch for changes
const watcher = chokidar.watch([
  path.join(workspaceDir, "MEMORY.md"),
  path.join(workspaceDir, "memory"),
], {
  ignoreInitial: true,
  awaitWriteFinish: { stabilityThreshold: 1000 },
});

let reindexTimer: NodeJS.Timeout | null = null;

watcher.on("change", () => {
  // Debounce re-indexing (avoid indexing too frequently)
  if (reindexTimer) clearTimeout(reindexTimer);
  
  reindexTimer = setTimeout(() => {
    semanticMemory.indexMemoryFiles(workspaceDir).catch(err => {
      console.error("Failed to re-index memory files:", err);
    });
  }, 500);
});

// Cleanup on exit
process.on("exit", () => {
  watcher.close();
  if (reindexTimer) clearTimeout(reindexTimer);
});
```

## Example 3: Custom Query Context

```typescript
// Use different queries for different scenarios

const scenarios = {
  // On startup: general context
  startup: "Tell me about my preferences and habits",
  
  // During development: technical preferences
  development: "What are my coding standards and technology preferences?",
  
  // During meetings: interaction style
  meetings: "How do I prefer to communicate and work with others?",
  
  // During problem-solving: relevant learnings
  problemSolving: "What important lessons have I learned about software development?",
};

for (const [scenario, query] of Object.entries(scenarios)) {
  const context = await semanticMemory.retrieveContext(query, {
    maxResults: 5,
    minSimilarity: 0.4,
  });
  
  console.log(`\n=== ${scenario.toUpperCase()} ===`);
  console.log(semanticMemory.formatContextForPrompt(context, 15));
}
```

## Example 4: Filtering by Source

```typescript
// Example: Only use daily notes for recent context

const context = await semanticMemory.retrieveContext(
  "What did I work on recently?"
);

// Filter to only recent memory files
const recentContext = {
  ...context,
  entries: context.entries.filter(e => {
    // Only entries from today's/yesterday's notes
    const isTodayOrYesterday = e.source.startsWith("memory/2026-02-0");
    return isTodayOrYesterday || e.source === "MEMORY.md";
  }),
};

console.log(semanticMemory.formatContextForPrompt(recentContext));
```

## Example 5: Relevance Feedback

```typescript
// Learn from user feedback to improve ranking

// After retrieving context, user rates entries:
const entry = context.entries[0];

// User found this entry very helpful
semanticMemory.updateRelevanceScore(entry.id, 0.9);

// User found this one less relevant
semanticMemory.updateRelevanceScore(otherEntry.id, 0.2);

// Next search will rank higher-relevance entries better
const improvedContext = await semanticMemory.retrieveContext(
  "Similar query later..."
);
// This time, better entries appear first
```

## Example 6: Memory Statistics

```typescript
// Monitor indexing status

const stats = semanticMemory.getIndexStats();

console.log("=== Memory Index Statistics ===");
console.log(`Total indexed entries: ${stats.totalEntries}`);
console.log(`Indexed files: ${stats.indexedFiles}`);
console.log(`Last updated: ${stats.lastUpdated}`);

if (stats.totalEntries === 0) {
  console.log("ℹ️  No memory files indexed yet");
  console.log("Indexing memory files...");
  await semanticMemory.indexMemoryFiles(workspaceDir);
}
```

## Example 7: Different Embedding Models

```typescript
// Switch embedding providers based on availability

async function getEmbeddingProvider(config: OpenClawConfig) {
  // Try OpenAI first (more accurate, costs money)
  if (config.providers?.anthropic?.apiKey) {
    console.log("Using OpenAI embeddings");
    return await createEmbeddingProvider({
      config,
      provider: "openai",
      model: "text-embedding-3-small",
      fallback: "local",
    });
  }
  
  // Fall back to local (free, offline)
  console.log("Using local embeddings");
  return await createEmbeddingProvider({
    config,
    provider: "local",
    model: "hf:ggml-org/embeddinggemma-300M-GGUF/embeddinggemma-300M-Q8_0.gguf",
    fallback: "none",
  });
}

const provider = await getEmbeddingProvider(config);
const vectorProvider = adaptEmbeddingProvider(provider, provider.dimensions);
const semanticMemory = new SemanticMemory(db, vectorProvider, workspaceDir);
```

## Example 8: Integration with Memory Search Tool

```typescript
// Complement keyword search with semantic search

import { MemoryIndexManager } from "./src/memory/index.js";

async function enhancedMemorySearch(query: string) {
  const results = {
    semantic: [] as SemanticMemoryResult[],
    keyword: [] as KeywordSearchResult[],
  };
  
  // Run both in parallel
  const [semanticResults, keywordResults] = await Promise.all([
    // Semantic search
    semanticMemory.retrieveContext(query, { maxResults: 5 }),
    
    // Keyword search (existing tool)
    memoryIndexManager.search(query, { maxResults: 5 }),
  ]);
  
  return {
    semantic: semanticResults.entries,
    keyword: keywordResults,
    combined: deduplicateAndRank([
      ...semanticResults.entries,
      ...keywordResults,
    ]),
  };
}

// Use the combined results
const { combined } = await enhancedMemorySearch(userQuery);
console.log("Best matches:", combined.slice(0, 3));
```

## Example 9: Batch Processing Memory Files

```typescript
// Index multiple files efficiently

const filesToIndex = [
  "MEMORY.md",
  "memory/2026-02-06.md",
  "memory/2026-02-05.md",
  "memory/2026-02-04.md",
];

console.log("Indexing memory files...");
for (const file of filesToIndex) {
  try {
    await semanticMemory.indexer.indexMemoryFile(file);
    console.log(`✓ Indexed ${file}`);
  } catch (error) {
    console.error(`✗ Failed to index ${file}:`, error);
  }
}

const stats = semanticMemory.getIndexStats();
console.log(`Total entries: ${stats.totalEntries}`);
```

## Example 10: Production-Grade Setup

```typescript
// Robust, production-ready semantic memory setup

interface SemanticMemoryConfig {
  enabled: boolean;
  maxResults: number;
  minSimilarity: number;
  embeddingModel: "openai" | "local" | "auto";
  timeoutMs: number;
  logStats: boolean;
}

class ProductionSemanticMemory {
  private semanticMemory: SemanticMemory;
  private config: SemanticMemoryConfig;
  private logger: Logger;
  
  constructor(
    db: Database,
    config: SemanticMemoryConfig,
    logger: Logger
  ) {
    this.config = config;
    this.logger = logger;
  }
  
  async initialize(workspaceDir: string): Promise<void> {
    if (!this.config.enabled) {
      this.logger.info("Semantic memory disabled");
      return;
    }
    
    try {
      const provider = await this.createEmbeddingProvider();
      const vectorProvider = adaptEmbeddingProvider(provider, 1536);
      
      this.semanticMemory = new SemanticMemory(
        db,
        vectorProvider,
        workspaceDir
      );
      
      await this.semanticMemory.initialize();
      await this.semanticMemory.indexMemoryFiles(workspaceDir);
      
      if (this.config.logStats) {
        const stats = this.semanticMemory.getIndexStats();
        this.logger.info("Semantic memory initialized", stats);
      }
    } catch (error) {
      this.logger.error("Semantic memory initialization failed", error);
      this.config.enabled = false; // Graceful degradation
    }
  }
  
  async retrieveWithTimeout(
    query: string
  ): Promise<SemanticMemoryContext | null> {
    if (!this.config.enabled || !this.semanticMemory) {
      return null;
    }
    
    try {
      const context = await Promise.race([
        this.semanticMemory.retrieveContext(query, {
          maxResults: this.config.maxResults,
          minSimilarity: this.config.minSimilarity,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("Semantic memory timeout")),
            this.config.timeoutMs
          )
        ),
      ]);
      
      return context;
    } catch (error) {
      this.logger.warn("Semantic memory retrieval timeout or error", error);
      return null;
    }
  }
  
  formatForPrompt(context: SemanticMemoryContext | null): string {
    if (!context || context.entries.length === 0) {
      return "";
    }
    
    return this.semanticMemory.formatContextForPrompt(context);
  }
  
  private async createEmbeddingProvider(): Promise<EmbeddingProvider> {
    // Implementation...
  }
}

// Usage
const semanticMemory = new ProductionSemanticMemory(
  db,
  {
    enabled: true,
    maxResults: 7,
    minSimilarity: 0.3,
    embeddingModel: "auto",
    timeoutMs: 1000,
    logStats: true,
  },
  logger
);

await semanticMemory.initialize(workspaceDir);
const context = await semanticMemory.retrieveWithTimeout(sessionQuery);
const formatted = semanticMemory.formatForPrompt(context);
```

## Troubleshooting Examples

### Example: Debug Retrieval

```typescript
const query = "What are my preferences?";

console.log("=== Semantic Memory Debug ===");
console.log("Query:", query);

const context = await semanticMemory.retrieveContext(query, {
  maxResults: 10,
  minSimilarity: 0.0, // Show all results
});

console.log(`Retrieved ${context.entries.length} entries in ${context.retrievalTime}ms`);

for (const entry of context.entries) {
  console.log(`
    Source: ${entry.source}
    Section: ${entry.section}
    Similarity: ${(entry.similarity * 100).toFixed(1)}%
    Relevance: ${(entry.relevance * 100).toFixed(1)}%
    Text: ${entry.text.substring(0, 100)}...
  `);
}
```

### Example: Test Different Thresholds

```typescript
const query = "Development best practices";

for (const threshold of [0.1, 0.3, 0.5, 0.7, 0.9]) {
  const results = await semanticMemory.retrieveContext(query, {
    minSimilarity: threshold,
  });
  console.log(`Threshold ${threshold}: ${results.entries.length} results`);
}

// Output:
// Threshold 0.1: 12 results
// Threshold 0.3: 8 results
// Threshold 0.5: 4 results
// Threshold 0.7: 1 result
// Threshold 0.9: 0 results
```

## Next Steps

- Read `SEMANTIC_MEMORY_IMPLEMENTATION.md` for architecture details
- Read `src/infra/SEMANTIC_MEMORY_INTEGRATION.md` for integration guide
- Check tests in `src/infra/semantic-memory.test.ts` and `src/memory/memory-indexer.test.ts`
- Integrate into `buildAgentSystemPrompt` in your agent setup
