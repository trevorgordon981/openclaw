/**
 * Vector Caching (Item 5)
 * Cache embeddings for semantic similarity queries
 * 8% cost savings
 */

export interface VectorCacheEntry {
  id: string;
  text: string;
  embedding: number[];
  metadata: Record<string, unknown>;
  createdAt: number;
  expiresAt: number;
  hitCount: number;
}

/**
 * Simple vector cache with LRU eviction
 */
export class VectorCache {
  private cache: Map<string, VectorCacheEntry> = new Map();
  private lruOrder: string[] = [];
  private maxVectors: number;
  private ttlMs: number;

  constructor(maxVectors: number = 500, ttlMs: number = 1800000) {
    this.maxVectors = maxVectors;
    this.ttlMs = ttlMs;
  }

  /**
   * Add or retrieve vector entry
   */
  set(id: string, text: string, embedding: number[], metadata?: Record<string, unknown>): string {
    if (this.cache.has(id)) {
      const entry = this.cache.get(id)!;
      entry.hitCount++;
      this.updateLRU(id);
      return id;
    }

    // Evict if needed
    if (this.cache.size >= this.maxVectors) {
      const lruKey = this.lruOrder.shift();
      if (lruKey) {
        this.cache.delete(lruKey);
      }
    }

    const entry: VectorCacheEntry = {
      id,
      text,
      embedding,
      metadata: metadata || {},
      createdAt: Date.now(),
      expiresAt: Date.now() + this.ttlMs,
      hitCount: 1,
    };

    this.cache.set(id, entry);
    this.lruOrder.push(id);

    return id;
  }

  /**
   * Get vector by ID
   */
  get(id: string): VectorCacheEntry | null {
    const entry = this.cache.get(id);

    if (!entry) {
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(id);
      return null;
    }

    entry.hitCount++;
    this.updateLRU(id);
    return entry;
  }

  /**
   * Find similar vectors using cosine similarity
   */
  findSimilar(
    embedding: number[],
    threshold: number = 0.85,
    limit: number = 5,
  ): Array<{ entry: VectorCacheEntry; similarity: number }> {
    const results: Array<{ entry: VectorCacheEntry; similarity: number }> = [];

    for (const [, entry] of this.cache) {
      if (Date.now() > entry.expiresAt) {
        continue;
      }

      const similarity = this.cosineSimilarity(embedding, entry.embedding);

      if (similarity >= threshold) {
        results.push({ entry, similarity });
      }
    }

    // Sort by similarity descending and limit results
    return results.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      return 0;
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) {
      return 0;
    }

    return dotProduct / denominator;
  }

  /**
   * Update LRU order
   */
  private updateLRU(id: string): void {
    const idx = this.lruOrder.indexOf(id);
    if (idx > -1) {
      this.lruOrder.splice(idx, 1);
    }
    this.lruOrder.push(id);
  }

  /**
   * Clean up expired entries
   */
  cleanup(): number {
    let removed = 0;
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        keysToDelete.push(key);
        removed++;
      }
    }

    keysToDelete.forEach((key) => {
      this.cache.delete(key);
      const idx = this.lruOrder.indexOf(key);
      if (idx > -1) {
        this.lruOrder.splice(idx, 1);
      }
    });

    return removed;
  }

  /**
   * Get cache statistics
   */
  stats(): {
    size: number;
    capacity: number;
    fillPercent: number;
    totalHits: number;
    avgHits: number;
  } {
    const entries = Array.from(this.cache.values());
    const totalHits = entries.reduce((sum, e) => sum + e.hitCount, 0);

    return {
      size: this.cache.size,
      capacity: this.maxVectors,
      fillPercent: (this.cache.size / this.maxVectors) * 100,
      totalHits,
      avgHits: entries.length > 0 ? Math.round((totalHits / entries.length) * 100) / 100 : 0,
    };
  }

  /**
   * Clear cache
   */
  clear(): void {
    this.cache.clear();
    this.lruOrder = [];
  }
}
