/**
 * Memory Indexer
 * 
 * Maintains a vector index of memory entries for semantic retrieval.
 * - Indexes MEMORY.md sections + memory/*.md files
 * - Tracks: text, embedding, source file, date, relevance score
 * - Auto-updates when memory files change
 * - Provides semantic search via cosine similarity
 * 
 * Storage: SQLite table `memory_embeddings` in the memory database
 */

import type { DatabaseSync } from "node:sqlite";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import type { VectorEmbeddingsProvider } from "../infra/vector-embeddings.js";
import { cosineSimilarity, normalizeVector } from "../infra/vector-embeddings.js";

export type MemoryIndexEntry = {
  id: string;
  sourceFile: string; // e.g., "MEMORY.md" or "memory/2026-02-06.md"
  section?: string; // Markdown section heading if applicable
  text: string;
  embedding: number[];
  date: string; // ISO date when entry was indexed
  relevanceScore: number; // User-assigned relevance (0-1)
};

export type SemanticSearchResult = {
  entry: MemoryIndexEntry;
  similarity: number;
  sourceFile: string;
  snippet: string;
};

/**
 * Memory Indexer: manages semantic memory entries and search
 */
export class MemoryIndexer {
  private db: DatabaseSync;
  private embeddingsProvider: VectorEmbeddingsProvider;
  private workspaceDir: string;
  private initialized: boolean = false;

  constructor(db: DatabaseSync, embeddingsProvider: VectorEmbeddingsProvider, workspaceDir: string) {
    this.db = db;
    this.embeddingsProvider = embeddingsProvider;
    this.workspaceDir = workspaceDir;
  }

  /**
   * Initialize the memory index schema
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_embeddings (
        id TEXT PRIMARY KEY,
        source_file TEXT NOT NULL,
        section TEXT,
        text TEXT NOT NULL,
        embedding BLOB NOT NULL,
        date TEXT NOT NULL,
        relevance_score REAL DEFAULT 0.5,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        indexed_version INTEGER DEFAULT 1
      );

      CREATE INDEX IF NOT EXISTS idx_memory_source ON memory_embeddings(source_file);
      CREATE INDEX IF NOT EXISTS idx_memory_date ON memory_embeddings(date);
      CREATE INDEX IF NOT EXISTS idx_memory_relevance ON memory_embeddings(relevance_score);
    `);

    this.initialized = true;
  }

  /**
   * Generate unique ID for a memory entry
   */
  private generateEntryId(sourceFile: string, section?: string): string {
    const base = `${sourceFile}:${section || "root"}`;
    // Simple hash-like id
    let hash = 0;
    for (let i = 0; i < base.length; i++) {
      const char = base.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return `mem_${Math.abs(hash).toString(36)}_${Date.now()}`;
  }

  /**
   * Parse markdown sections from text (simple headings extraction)
   */
  private parseMarkdownSections(text: string): Array<{ section?: string; content: string }> {
    const sections: Array<{ section?: string; content: string }> = [];
    const lines = text.split("\n");
    let currentSection: string | undefined;
    let currentContent: string[] = [];

    for (const line of lines) {
      const headingMatch = line.match(/^#+\s+(.+)$/);
      if (headingMatch) {
        // Save previous section
        if (currentContent.length > 0) {
          sections.push({
            section: currentSection,
            content: currentContent.join("\n").trim(),
          });
        }
        currentSection = headingMatch[1];
        currentContent = [];
      } else {
        currentContent.push(line);
      }
    }

    // Save last section
    if (currentContent.length > 0) {
      sections.push({
        section: currentSection,
        content: currentContent.join("\n").trim(),
      });
    }

    return sections.filter((s) => s.content.length > 0);
  }

  /**
   * Index a memory file (MEMORY.md or memory/*.md)
   */
  async indexMemoryFile(relPath: string): Promise<void> {
    const fullPath = path.join(this.workspaceDir, relPath);

    try {
      const content = await fs.readFile(fullPath, "utf-8");
      const sections = this.parseMarkdownSections(content);

      // Get embeddings for all sections
      const textsToEmbed = sections.map((s) => s.content);
      const embeddings = await this.embeddingsProvider.embedBatch(textsToEmbed);

      // Insert or update entries
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO memory_embeddings 
        (id, source_file, section, text, embedding, date, relevance_score, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const today = new Date().toISOString().split("T")[0];

      for (let i = 0; i < sections.length; i++) {
        const section = sections[i];
        const embedding = embeddings[i];
        const entryId = this.generateEntryId(relPath, section.section);

        stmt.run(
          entryId,
          relPath,
          section.section,
          section.content,
          Buffer.from(new Float32Array(embedding).buffer),
          today,
          0.5, // Default relevance
          new Date().toISOString(),
        );
      }
    } catch (error) {
      console.error(`Failed to index memory file ${relPath}:`, error);
    }
  }

  /**
   * Semantic search: find relevant memory entries by meaning
   */
  async semanticSearch(
    query: string,
    options?: { maxResults?: number; minSimilarity?: number },
  ): Promise<SemanticSearchResult[]> {
    const maxResults = options?.maxResults ?? 10;
    const minSimilarity = options?.minSimilarity ?? 0.3;

    // Get query embedding
    const queryEmbedding = await this.embeddingsProvider.embedQuery(query);
    const normalizedQuery = normalizeVector(queryEmbedding);

    // Fetch all entries from database
    const stmt = this.db.prepare(`
      SELECT id, source_file, section, text, embedding, date, relevance_score
      FROM memory_embeddings
      ORDER BY relevance_score DESC
    `);

    const entries = stmt.all() as Array<{
      id: string;
      source_file: string;
      section?: string;
      text: string;
      embedding: Buffer;
      date: string;
      relevance_score: number;
    }>;

    // Calculate similarity for each entry
    const results: SemanticSearchResult[] = [];

    for (const entry of entries) {
      const embedding = Array.from(new Float32Array(entry.embedding.buffer));
      const normalizedEmbedding = normalizeVector(embedding);
      const similarity = cosineSimilarity(normalizedQuery, normalizedEmbedding);

      if (similarity >= minSimilarity) {
        results.push({
          entry: {
            id: entry.id,
            sourceFile: entry.source_file,
            section: entry.section,
            text: entry.text,
            embedding,
            date: entry.date,
            relevanceScore: entry.relevance_score,
          },
          similarity,
          sourceFile: entry.source_file,
          snippet: entry.text.substring(0, 200) + (entry.text.length > 200 ? "..." : ""),
        });
      }
    }

    // Sort by similarity (descending) and relevance score (descending)
    results.sort((a, b) => {
      const simDiff = b.similarity - a.similarity;
      if (Math.abs(simDiff) > 0.05) {
        return simDiff;
      }
      return b.entry.relevanceScore - a.entry.relevanceScore;
    });

    return results.slice(0, maxResults);
  }

  /**
   * Update relevance score for an entry (user feedback)
   */
  updateRelevanceScore(entryId: string, score: number): void {
    const stmt = this.db.prepare(`
      UPDATE memory_embeddings
      SET relevance_score = ?, updated_at = ?
      WHERE id = ?
    `);
    stmt.run(Math.max(0, Math.min(1, score)), new Date().toISOString(), entryId);
  }

  /**
   * Get all indexed files
   */
  getIndexedFiles(): string[] {
    const stmt = this.db.prepare(`
      SELECT DISTINCT source_file FROM memory_embeddings
      ORDER BY source_file
    `);
    return stmt.all().map((row: any) => row.source_file);
  }

  /**
   * Clear index for a specific file (before re-indexing)
   */
  clearFileIndex(relPath: string): void {
    const stmt = this.db.prepare(`DELETE FROM memory_embeddings WHERE source_file = ?`);
    stmt.run(relPath);
  }

  /**
   * Get index statistics
   */
  getStats(): {
    totalEntries: number;
    indexedFiles: number;
    lastUpdated: string | null;
  } {
    const countStmt = this.db.prepare(`SELECT COUNT(*) as count FROM memory_embeddings`);
    const count = (countStmt.get() as any).count;

    const filesStmt = this.db.prepare(`
      SELECT COUNT(DISTINCT source_file) as count FROM memory_embeddings
    `);
    const files = (filesStmt.get() as any).count;

    const dateStmt = this.db.prepare(`
      SELECT MAX(updated_at) as date FROM memory_embeddings
    `);
    const lastUpdated = (dateStmt.get() as any).date;

    return {
      totalEntries: count,
      indexedFiles: files,
      lastUpdated,
    };
  }
}
