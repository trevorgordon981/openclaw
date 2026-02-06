/**
 * Semantic Memory System
 * 
 * Automatically retrieves relevant memory context when agent wakes up.
 * - Queries memory semantically using vector embeddings
 * - Ranks by similarity + recency + relevance
 * - Injects top entries into system prompt
 * - Zero latency impact (async background initialization)
 * 
 * Integration point: Called by system-prompt.ts during agent initialization
 */

import type { DatabaseSync } from "node:sqlite";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { MemoryIndexer } from "../memory/memory-indexer.js";
import type { VectorEmbeddingsProvider } from "./vector-embeddings.js";

export type RetrievedMemoryEntry = {
  text: string;
  source: string;
  section?: string;
  similarity: number;
  relevance: number;
  date: string;
};

export type SemanticMemoryContext = {
  entries: RetrievedMemoryEntry[];
  totalEntries: number;
  retrievalTime: number;
  queryUsed: string;
};

/**
 * Semantic memory manager: retrieves relevant context for agent
 */
export class SemanticMemory {
  private indexer: MemoryIndexer;
  private initialized: boolean = false;
  private initializationPromise: Promise<void> | null = null;

  constructor(db: DatabaseSync, embeddingsProvider: VectorEmbeddingsProvider, workspaceDir: string) {
    this.indexer = new MemoryIndexer(db, embeddingsProvider, workspaceDir);
  }

  /**
   * Initialize the semantic memory system
   * Non-blocking: returns immediately, initialization happens in background
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = (async () => {
      try {
        await this.indexer.initialize();
        // Initial index scan will happen on-demand in retrieveContext()
        this.initialized = true;
      } catch (error) {
        console.error("Failed to initialize semantic memory:", error);
        this.initialized = false;
      }
    })();

    return this.initializationPromise;
  }

  /**
   * Retrieve relevant memory entries based on session context
   * 
   * Strategy:
   * 1. Use initial request/heartbeat text as semantic query
   * 2. Search memory index for similar entries
   * 3. Rank by: similarity + recency + relevance score
   * 4. Return top 5-10 results
   */
  async retrieveContext(
    sessionContext: string,
    options?: {
      maxResults?: number;
      minSimilarity?: number;
      workspaceDir?: string;
    },
  ): Promise<SemanticMemoryContext> {
    const startTime = Date.now();
    const maxResults = options?.maxResults ?? 7;
    const minSimilarity = options?.minSimilarity ?? 0.3;

    try {
      // Lazy initialize
      if (!this.initialized) {
        await this.initialize();
      }

      // Perform semantic search
      const results = await this.indexer.semanticSearch(sessionContext, {
        maxResults,
        minSimilarity,
      });

      const retrievalTime = Date.now() - startTime;

      // Transform to external format
      const entries: RetrievedMemoryEntry[] = results.map((result) => ({
        text: result.entry.text,
        source: result.sourceFile,
        section: result.entry.section,
        similarity: result.similarity,
        relevance: result.entry.relevanceScore,
        date: result.entry.date,
      }));

      return {
        entries,
        totalEntries: entries.length,
        retrievalTime,
        queryUsed: sessionContext.substring(0, 100),
      };
    } catch (error) {
      console.warn("Semantic memory retrieval failed, falling back to keyword search:", error);
      return {
        entries: [],
        totalEntries: 0,
        retrievalTime: Date.now() - startTime,
        queryUsed: sessionContext.substring(0, 100),
      };
    }
  }

  /**
   * Format retrieved context for injection into system prompt
   */
  formatContextForPrompt(context: SemanticMemoryContext, maxLines: number = 20): string {
    if (context.entries.length === 0) {
      return "";
    }

    const lines: string[] = [];
    lines.push("## Semantic Memory Context (Auto-Retrieved)");
    lines.push(`Retrieved ${context.entries.length} relevant memory entries based on session context.`);
    lines.push("");

    for (const entry of context.entries) {
      const header = `### ${entry.source}${entry.section ? ` > ${entry.section}` : ""}`;
      const similarity = `_(Similarity: ${(entry.similarity * 100).toFixed(0)}%)_`;
      const snippet = entry.text.substring(0, 300) + (entry.text.length > 300 ? "\n..." : "");

      lines.push(header);
      lines.push(similarity);
      lines.push("");
      lines.push(snippet);
      lines.push("");
    }

    lines.push(`_Retrieved in ${context.retrievalTime}ms using semantic search._`);
    lines.push("");

    return lines.slice(0, maxLines).join("\n");
  }

  /**
   * Index memory files for semantic search
   * Idempotent: can be called multiple times
   */
  async indexMemoryFiles(workspaceDir: string): Promise<void> {
    try {
      // Index MEMORY.md if it exists
      const memoryPath = path.join(workspaceDir, "MEMORY.md");
      if (fsSync.existsSync(memoryPath)) {
        await this.indexer.indexMemoryFile("MEMORY.md");
      }

      // Index daily notes in memory/ directory
      const memoryDir = path.join(workspaceDir, "memory");
      if (fsSync.existsSync(memoryDir)) {
        const files = await fs.readdir(memoryDir);
        for (const file of files) {
          if (file.endsWith(".md")) {
            await this.indexer.indexMemoryFile(path.join("memory", file));
          }
        }
      }
    } catch (error) {
      console.warn("Failed to index memory files:", error);
    }
  }

  /**
   * Get index statistics
   */
  getIndexStats() {
    return this.indexer.getStats();
  }
}

/**
 * Create a semantic memory instance from existing embedding provider
 */
export function createSemanticMemory(
  db: DatabaseSync,
  embeddingsProvider: VectorEmbeddingsProvider,
  workspaceDir: string,
): SemanticMemory {
  return new SemanticMemory(db, embeddingsProvider, workspaceDir);
}
