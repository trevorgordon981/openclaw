/**
 * Semantic Memory Tests
 * 
 * Test suite for semantic retrieval, ranking, and integration
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import type { VectorEmbeddingsProvider } from "./vector-embeddings.js";
import { SemanticMemory } from "./semantic-memory.js";
import { normalizeVector, cosineSimilarity } from "./vector-embeddings.js";

/**
 * Mock embedding provider for testing
 */
class MockEmbeddingProvider implements VectorEmbeddingsProvider {
  id = "mock-provider";
  model = "mock-model";
  dimensions = 4;

  // Simple word-based embedding for testing
  private getSimpleEmbedding(text: string): number[] {
    const words = text.toLowerCase().split(/\s+/);
    const vec = new Array(this.dimensions).fill(0);

    // Simple hash-based embedding
    for (const word of words) {
      let hash = 0;
      for (let i = 0; i < word.length; i++) {
        hash = (hash << 5) - hash + word.charCodeAt(i);
      }
      for (let i = 0; i < this.dimensions; i++) {
        vec[i] += Math.sin((hash + i) * 0.1);
      }
    }

    return normalizeVector(vec);
  }

  async embedQuery(text: string): Promise<number[]> {
    return this.getSimpleEmbedding(text);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.getSimpleEmbedding(text));
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }
}

describe("SemanticMemory", () => {
  let tempDir: string;
  let db: Database.Database;
  let provider: MockEmbeddingProvider;
  let semanticMemory: SemanticMemory;

  beforeEach(async () => {
    // Create temporary workspace
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "semantic-memory-test-"));

    // Create test memory files
    const memoryPath = path.join(tempDir, "MEMORY.md");
    await fs.writeFile(
      memoryPath,
      `# Core Preferences

## Language Preferences

I prefer Python over JavaScript for data processing tasks.
Python's ecosystem is better for machine learning.

## Framework Preferences

For web development, I like using Flask and FastAPI.
React is good for frontend work.

# Project Guidelines

## Coding Standards

Always write unit tests for new features.
Use type hints in Python code.
`,
    );

    // Create daily note
    const dailyNotePath = path.join(tempDir, "memory", "2026-02-06.md");
    await fs.mkdir(path.dirname(dailyNotePath), { recursive: true });
    await fs.writeFile(
      dailyNotePath,
      `# February 6, 2026

## Tasks Completed

Implemented semantic memory system for OpenClaw.
Used vector embeddings for similarity search.

## Learnings

Cosine similarity is effective for text retrieval.
SQLite works well for small-scale embedding storage.
`,
    );

    // Setup database
    db = new Database(":memory:");
    provider = new MockEmbeddingProvider();
    semanticMemory = new SemanticMemory(db, provider, tempDir);
    await semanticMemory.initialize();
  });

  afterEach(async () => {
    db.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should initialize without errors", async () => {
    expect(() => semanticMemory.initialize()).not.toThrow();
  });

  it("should index memory files", async () => {
    await semanticMemory.indexMemoryFiles(tempDir);

    const stats = semanticMemory.getIndexStats();
    expect(stats.totalEntries).toBeGreaterThan(0);
    expect(stats.indexedFiles).toBeGreaterThan(0);
  });

  it("should retrieve semantically similar entries", async () => {
    await semanticMemory.indexMemoryFiles(tempDir);

    const context = await semanticMemory.retrieveContext(
      "What language should I use for data processing?"
    );

    expect(context.entries.length).toBeGreaterThan(0);
    expect(context.totalEntries).toBeGreaterThan(0);
  });

  it("should rank results by similarity", async () => {
    await semanticMemory.indexMemoryFiles(tempDir);

    const context = await semanticMemory.retrieveContext("Python programming language");

    if (context.entries.length > 0) {
      // First result should have highest similarity
      expect(context.entries[0].similarity).toBeGreaterThanOrEqual(context.entries[1]?.similarity || 0);
    }
  });

  it("should respect minSimilarity threshold", async () => {
    await semanticMemory.indexMemoryFiles(tempDir);

    const context = await semanticMemory.retrieveContext("random unrelated query", {
      minSimilarity: 0.8,
    });

    // All returned entries should meet the threshold
    for (const entry of context.entries) {
      expect(entry.similarity).toBeGreaterThanOrEqual(0.8);
    }
  });

  it("should format context for prompt", async () => {
    await semanticMemory.indexMemoryFiles(tempDir);

    const context = await semanticMemory.retrieveContext(
      "What are my coding preferences?"
    );

    const formatted = semanticMemory.formatContextForPrompt(context);

    if (context.entries.length > 0) {
      expect(formatted).toContain("Semantic Memory Context");
      expect(formatted).toContain("Similarity");
    }
  });

  it("should handle empty queries gracefully", async () => {
    const context = await semanticMemory.retrieveContext("");

    expect(context).toHaveProperty("entries");
    expect(context).toHaveProperty("totalEntries");
    expect(context).toHaveProperty("retrievalTime");
  });

  it("should maintain retrieval performance", async () => {
    await semanticMemory.indexMemoryFiles(tempDir);

    const startTime = Date.now();
    const context = await semanticMemory.retrieveContext("test query");
    const elapsedTime = Date.now() - startTime;

    // Should complete within reasonable time (adjust threshold as needed)
    expect(elapsedTime).toBeLessThan(1000); // 1 second max
  });
});

describe("Vector Embeddings", () => {
  it("should compute cosine similarity correctly", () => {
    const vec1 = [1, 0, 0];
    const vec2 = [1, 0, 0];
    const vec3 = [0, 1, 0];

    expect(cosineSimilarity(vec1, vec2)).toBeCloseTo(1.0);
    expect(cosineSimilarity(vec1, vec3)).toBeCloseTo(0.0, 1);
  });

  it("should normalize vectors", () => {
    const vec = [3, 4];
    const normalized = normalizeVector(vec);

    const magnitude = Math.sqrt(normalized[0] ** 2 + normalized[1] ** 2);
    expect(magnitude).toBeCloseTo(1.0);
  });

  it("should handle zero vectors", () => {
    const vec = [0, 0, 0];
    expect(() => normalizeVector(vec)).not.toThrow();
  });
});

describe("Integration: Semantic Memory with Keyword Search", () => {
  let tempDir: string;
  let db: Database.Database;
  let provider: MockEmbeddingProvider;
  let semanticMemory: SemanticMemory;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "semantic-integration-test-"));

    // Create a detailed memory file
    const memoryPath = path.join(tempDir, "MEMORY.md");
    await fs.writeFile(
      memoryPath,
      `# User Profile

## Technical Stack

I use TypeScript for backend development.
Frontend framework of choice is React with Next.js.
Database: PostgreSQL for production, SQLite for testing.

## Work Habits

I prefer async communication over synchronous meetings.
Early morning (6-8 AM) is my peak productivity time.
I review code thoroughly before merging to main branch.
`,
    );

    db = new Database(":memory:");
    provider = new MockEmbeddingProvider();
    semanticMemory = new SemanticMemory(db, provider, tempDir);
    await semanticMemory.initialize();
    await semanticMemory.indexMemoryFiles(tempDir);
  });

  afterEach(async () => {
    db.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should find memories even with different phrasing", async () => {
    // User asks about work schedule with different wording
    const context = await semanticMemory.retrieveContext(
      "When do I work most efficiently?"
    );

    expect(context.entries.length).toBeGreaterThan(0);
    // Should find the early morning productivity preference
    const foundRelevant = context.entries.some((e) =>
      e.text.toLowerCase().includes("peak productivity")
    );
    expect(foundRelevant).toBe(true);
  });

  it("should rank better matches higher", async () => {
    const context = await semanticMemory.retrieveContext(
      "What backend technology should I use?"
    );

    if (context.entries.length > 1) {
      // TypeScript/backend entry should rank higher than database entry
      const backendIdx = context.entries.findIndex((e) =>
        e.text.toLowerCase().includes("typescript")
      );
      const dbIdx = context.entries.findIndex((e) =>
        e.text.toLowerCase().includes("database")
      );

      if (backendIdx >= 0 && dbIdx >= 0) {
        expect(context.entries[backendIdx].similarity).toBeGreaterThanOrEqual(
          context.entries[dbIdx].similarity
        );
      }
    }
  });
});
