/**
 * Prompt Caching - Cache system prompts and context using semantic + hash-based strategies
 * - TTL-based expiration
 * - LRU eviction when cache is full
 * Estimated savings: 20% cost per cache hit
 */

import crypto from "crypto";

export interface CacheEntry<T> {
  key: string;
  value: T;
  hash: string;
  createdAt: number;
  expiresAt: number;
  hitCount: number;
  semanticId?: string; // For semantic deduplication
}

export interface PromptCacheConfig {
  maxEntries: number;
  ttlMs: number; // Time to live in milliseconds
  enableSemanticDedup: boolean;
}

/**
 * LRU-enabled prompt cache with TTL and semantic deduplication
 */
export class PromptCache<T> {
  private cache: Map<string, CacheEntry<T>> = new Map();
  private lruOrder: string[] = []; // Tracks access order for LRU eviction
  private config: PromptCacheConfig;

  constructor(config: Partial<PromptCacheConfig> = {}) {
    this.config = {
      maxEntries: config.maxEntries ?? 100,
      ttlMs: config.ttlMs ?? 3600000, // 1 hour default
      enableSemanticDedup: config.enableSemanticDedup ?? true,
    };
  }

  /**
   * Generate hash of content for cache key
   */
  private generateHash(content: string): string {
    return crypto.createHash("sha256").update(content).digest("hex").substring(0, 12);
  }

  /**
   * Simple semantic ID based on content patterns
   * In production, would use vector embeddings
   */
  private generateSemanticId(content: string): string {
    // Extract key phrases for semantic bucketing
    const phrases = content
      .split(/[.!?;]+/)
      .filter((p) => p.length > 10)
      .slice(0, 3)
      .map((p) => p.trim().split(/\s+/).slice(0, 3).join(" "));

    return crypto.createHash("md5").update(phrases.join("|")).digest("hex").substring(0, 8);
  }

  /**
   * Check if entry has expired
   */
  private isExpired(entry: CacheEntry<T>): boolean {
    return Date.now() > entry.expiresAt;
  }

  /**
   * Update LRU order - move key to end (most recently used)
   */
  private updateLRU(key: string): void {
    const idx = this.lruOrder.indexOf(key);
    if (idx > -1) {
      this.lruOrder.splice(idx, 1);
    }
    this.lruOrder.push(key);
  }

  /**
   * Evict least recently used entry
   */
  private evictLRU(): void {
    if (this.lruOrder.length === 0) return;

    const lruKey = this.lruOrder.shift();
    if (lruKey) {
      this.cache.delete(lruKey);
    }
  }

  /**
   * Set cache entry with semantic deduplication
   */
  set(key: string, value: T, content?: string): string {
    const hash = content ? this.generateHash(content) : "";
    const semanticId =
      content && this.config.enableSemanticDedup ? this.generateSemanticId(content) : undefined;

    // Check for semantic duplicates
    if (semanticId && this.config.enableSemanticDedup) {
      const existing = Array.from(this.cache.values()).find(
        (e) => e.semanticId === semanticId && !this.isExpired(e),
      );
      if (existing) {
        existing.hitCount++;
        this.updateLRU(existing.key);
        return existing.key;
      }
    }

    // Evict if at capacity
    if (this.cache.size >= this.config.maxEntries) {
      this.evictLRU();
    }

    const entry: CacheEntry<T> = {
      key,
      value,
      hash,
      createdAt: Date.now(),
      expiresAt: Date.now() + this.config.ttlMs,
      hitCount: 1,
      semanticId,
    };

    this.cache.set(key, entry);
    this.updateLRU(key);

    return key;
  }

  /**
   * Retrieve from cache with TTL validation
   */
  get(key: string): T | null {
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    if (this.isExpired(entry)) {
      this.cache.delete(key);
      return null;
    }

    entry.hitCount++;
    this.updateLRU(key);
    return entry.value;
  }

  /**
   * Get by semantic similarity (for semantic dedup)
   */
  getBySemanticId(semanticId: string): T | null {
    const entry = Array.from(this.cache.values()).find(
      (e) => e.semanticId === semanticId && !this.isExpired(e),
    );

    if (!entry) {
      return null;
    }

    entry.hitCount++;
    this.updateLRU(entry.key);
    return entry.value;
  }

  /**
   * Clear expired entries
   */
  cleanup(): number {
    let removed = 0;
    const keysToDelete: string[] = [];

    for (const [key, entry] of this.cache.entries()) {
      if (this.isExpired(entry)) {
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
    hitRate: number;
    avgHits: number;
  } {
    const entries = Array.from(this.cache.values());
    const totalHits = entries.reduce((sum, e) => sum + e.hitCount, 0);
    const avgHits = entries.length > 0 ? totalHits / entries.length : 0;

    return {
      size: this.cache.size,
      capacity: this.config.maxEntries,
      hitRate: (this.cache.size / this.config.maxEntries) * 100,
      avgHits: Math.round(avgHits * 100) / 100,
    };
  }

  /**
   * Clear all cache
   */
  clear(): void {
    this.cache.clear();
    this.lruOrder = [];
  }
}
