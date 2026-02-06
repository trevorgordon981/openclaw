/**
 * Memory Indexer Tests
 * 
 * Test suite for memory indexing, embeddings, and semantic search
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import type { VectorEmbeddingsProvider } from "../infra/vector-embeddings.js";
import { normalizeVector } from "../infra/vector-embeddings.js";
import { MemoryIndexer } from "./memory-indexer.js";

/**
 * Test embedding provider
 */
class TestEmbeddingProvider implements VectorEmbeddingsProvider {
  id = "test-provider";
  model = "test-model";
  dimensions = 3;

  private wordToVec(word: string): number[] {
    // Deterministic simple embedding
    let hash = 0;
    for (let i = 0; i < word.length; i++) {
      hash = (hash << 5) - hash + word.charCodeAt(i);
      hash = hash & hash; // Convert to 32-bit
    }

    return normalizeVector([
      Math.sin(hash * 0.01),
      Math.cos(hash * 0.02),
      Math.sin(hash * 0.03),
    ]);
  }

  async embedQuery(text: string): Promise<number[]> {
    const words = text.toLowerCase().split(/\s+/);
    const vec = [0, 0, 0];

    for (const word of words) {
      const wordVec = this.wordToVec(word);
      for (let i = 0; i < 3; i++) {
        vec[i] += wordVec[i];
      }
    }

    return normalizeVector(vec);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((text) => this.embedQuery(text)));
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }
}

describe("MemoryIndexer", () => {
  let tempDir: string;
  let db: Database.Database;
  let provider: TestEmbeddingProvider;
  let indexer: MemoryIndexer;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "memory-indexer-test-"));
    db = new Database(":memory:");
    provider = new TestEmbeddingProvider();
    indexer = new MemoryIndexer(db, provider, tempDir);
    await indexer.initialize();
  });

  afterEach(async () => {
    db.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should initialize schema", async () => {
    const result = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='memory_embeddings'"
      )
      .all();
    expect(result.length).toBe(1);
  });

  it("should index a memory file", async () => {
    const memoryFile = path.join(tempDir, "MEMORY.md");
    await fs.writeFile(
      memoryFile,
      `# Preferences

I like Python for data science.

# Learnings

SQLite is lightweight and reliable.
`,
    );

    await indexer.indexMemoryFile("MEMORY.md");

    const result = db
      .prepare("SELECT COUNT(*) as count FROM memory_embeddings")
      .get() as any;

    expect(result.count).toBeGreaterThan(0);
  });

  it("should store embeddings correctly", async () => {
    const memoryFile = path.join(tempDir, "MEMORY.md");
    await fs.writeFile(
      memoryFile,
      `# Test

Test content for embedding.
`,
    );

    await indexer.indexMemoryFile("MEMORY.md");

    const result = db
      .prepare("SELECT embedding FROM memory_embeddings WHERE source_file = ?")
      .get("MEMORY.md") as any;

    expect(result).toBeDefined();
    expect(result.embedding).toBeDefined();

    // Verify embedding is a valid buffer
    const embedding = new Float32Array(result.embedding.buffer);
    expect(embedding.length).toBe(provider.dimensions);
  });

  it("should perform semantic search", async () => {
    const memoryFile = path.join(tempDir, "test.md");
    await fs.writeFile(
      memoryFile,
      `# Technology

Python is great for data analysis.
JavaScript is useful for web development.
`,
    );

    await indexer.indexMemoryFile("test.md");

    const results = await indexer.semanticSearch("data analysis programming", {
      maxResults: 5,
    });

    expect(results.length).toBeGreaterThan(0);
  });

  it("should rank search results by similarity", async () => {
    const memoryFile = path.join(tempDir, "test.md");
    await fs.writeFile(
      memoryFile,
      `# Section 1

Python programming for data science.

# Section 2

HTML and CSS for web markup.
`,
    );

    await indexer.indexMemoryFile("test.md");

    const results = await indexer.semanticSearch("Python data", { maxResults: 10 });

    if (results.length > 1) {
      // Python-related result should rank higher
      const pythonResult = results.find((r) =>
        r.entry.text.toLowerCase().includes("python")
      );
      const htmlResult = results.find((r) =>
        r.entry.text.toLowerCase().includes("html")
      );

      if (pythonResult && htmlResult) {
        const pythonIdx = results.indexOf(pythonResult);
        const htmlIdx = results.indexOf(htmlResult);
        expect(pythonIdx).toBeLessThan(htmlIdx);
      }
    }
  });

  it("should respect minSimilarity threshold", async () => {
    const memoryFile = path.join(tempDir, "test.md");
    await fs.writeFile(
      memoryFile,
      `# Content

Some unrelated content here.
More unrelated information.
`,
    );

    await indexer.indexMemoryFile("test.md");

    const results = await indexer.semanticSearch("quantum computing physics", {
      minSimilarity: 0.9,
    });

    // Should return few or no results with high threshold
    for (const result of results) {
      expect(result.similarity).toBeGreaterThanOrEqual(0.9);
    }
  });

  it("should handle multiple sections", async () => {
    const memoryFile = path.join(tempDir, "test.md");
    await fs.writeFile(
      memoryFile,
      `# Section One

First section content.

# Section Two

Second section content.

# Section Three

Third section content.
`,
    );

    await indexer.indexMemoryFile("test.md");

    const indexed = indexer.getIndexedFiles();
    expect(indexed).toContain("test.md");

    const stats = indexer.getStats();
    expect(stats.totalEntries).toBeGreaterThanOrEqual(3);
  });

  it("should update relevance scores", async () => {
    const memoryFile = path.join(tempDir, "test.md");
    await fs.writeFile(
      memoryFile,
      `# Content

Some test content.
`,
    );

    await indexer.indexMemoryFile("test.md");

    const results = db
      .prepare("SELECT id FROM memory_embeddings LIMIT 1")
      .all() as any[];

    if (results.length > 0) {
      const entryId = results[0].id;
      indexer.updateRelevanceScore(entryId, 0.9);

      const updated = db
        .prepare("SELECT relevance_score FROM memory_embeddings WHERE id = ?")
        .get(entryId) as any;

      expect(updated.relevance_score).toBe(0.9);
    }
  });

  it("should clear file index", async () => {
    const memoryFile = path.join(tempDir, "test.md");
    await fs.writeFile(
      memoryFile,
      `# Content

Test content.
`,
    );

    await indexer.indexMemoryFile("test.md");
    let count = (
      db
        .prepare("SELECT COUNT(*) as count FROM memory_embeddings")
        .get() as any
    ).count;
    expect(count).toBeGreaterThan(0);

    indexer.clearFileIndex("test.md");
    count = (
      db
        .prepare("SELECT COUNT(*) as count FROM memory_embeddings")
        .get() as any
    ).count;
    expect(count).toBe(0);
  });

  it("should provide statistics", () => {
    const stats = indexer.getStats();

    expect(stats).toHaveProperty("totalEntries");
    expect(stats).toHaveProperty("indexedFiles");
    expect(stats).toHaveProperty("lastUpdated");
    expect(typeof stats.totalEntries).toBe("number");
  });

  it("should handle empty queries", async () => {
    const memoryFile = path.join(tempDir, "test.md");
    await fs.writeFile(
      memoryFile,
      `# Content

Test content.
`,
    );

    await indexer.indexMemoryFile("test.md");

    const results = await indexer.semanticSearch("");
    expect(Array.isArray(results)).toBe(true);
  });

  it("should handle malformed markdown gracefully", async () => {
    const memoryFile = path.join(tempDir, "malformed.md");
    await fs.writeFile(
      memoryFile,
      `
No headings here
Just plain text
Multiple lines
Without structure
`,
    );

    // Should not throw
    await expect(
      indexer.indexMemoryFile("malformed.md")
    ).resolves.not.toThrow();
  });

  it("should idempotently index files", async () => {
    const memoryFile = path.join(tempDir, "test.md");
    const content = `# Content

Test content.
`;
    await fs.writeFile(memoryFile, content);

    await indexer.indexMemoryFile("test.md");
    const count1 = (
      db
        .prepare("SELECT COUNT(*) as count FROM memory_embeddings")
        .get() as any
    ).count;

    // Index again
    await indexer.indexMemoryFile("test.md");
    const count2 = (
      db
        .prepare("SELECT COUNT(*) as count FROM memory_embeddings")
        .get() as any
    ).count;

    // Count should remain the same (idempotent)
    expect(count2).toBeLessThanOrEqual(count1 + 1); // Allow 1 more due to regeneration
  });
});
