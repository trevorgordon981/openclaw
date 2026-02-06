/**
 * Vector Embeddings Abstraction Layer
 * 
 * Provides a pluggable interface for embedding models (OpenAI, local, etc.).
 * Abstraction enables swapping embedding providers without changing semantic memory code.
 */

export type EmbeddingResult = {
  text: string;
  vector: number[];
  dimensions: number;
  modelId: string;
};

export type BatchEmbeddingResult = {
  texts: string[];
  vectors: number[][];
  dimensions: number;
  modelId: string;
  failedIndices?: number[];
};

export interface VectorEmbeddingsProvider {
  /**
   * Unique identifier for this provider (e.g., "openai-text-embedding-3-small")
   */
  id: string;

  /**
   * Model name/identifier
   */
  model: string;

  /**
   * Embedding dimensions (e.g., 1536 for OpenAI)
   */
  dimensions: number;

  /**
   * Embed a single text query (e.g., for semantic search)
   */
  embedQuery(text: string): Promise<number[]>;

  /**
   * Embed multiple texts in a batch (more efficient than individual calls)
   */
  embedBatch(texts: string[]): Promise<number[][]>;

  /**
   * Check if the provider is available/working
   */
  isAvailable(): Promise<boolean>;

  /**
   * Shutdown provider resources if needed
   */
  close?(): Promise<void>;
}

/**
 * Cosine similarity between two vectors (0-1, where 1 = identical)
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error("Vector dimensions must match");
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dotProduct / (normA * normB);
}

/**
 * Euclidean distance between two vectors
 */
export function euclideanDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error("Vector dimensions must match");
  }

  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }

  return Math.sqrt(sum);
}

/**
 * Rank vectors by similarity to a query vector
 * Returns indices sorted by descending similarity
 */
export function rankByCosineSimilarity(
  queryVector: number[],
  vectors: number[][],
  topK?: number,
): Array<{ index: number; similarity: number }> {
  const similarities = vectors.map((vec, index) => ({
    index,
    similarity: cosineSimilarity(queryVector, vec),
  }));

  similarities.sort((a, b) => b.similarity - a.similarity);

  return topK ? similarities.slice(0, topK) : similarities;
}

/**
 * Normalize a vector to unit length (for cosine similarity)
 */
export function normalizeVector(vec: number[]): number[] {
  const magnitude = Math.sqrt(vec.reduce((sum, val) => sum + val * val, 0));
  if (magnitude < 1e-10) {
    return vec;
  }
  return vec.map((val) => val / magnitude);
}
