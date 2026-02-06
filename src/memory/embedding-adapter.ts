/**
 * Embedding Adapter
 * 
 * Adapts OpenClaw's EmbeddingProvider to VectorEmbeddingsProvider interface.
 * Enables semantic memory to work with any OpenClaw embedding backend.
 */

import type { EmbeddingProvider } from "./embeddings.js";
import type { VectorEmbeddingsProvider } from "../infra/vector-embeddings.js";

export function adaptEmbeddingProvider(
  provider: EmbeddingProvider,
  dimensions: number,
): VectorEmbeddingsProvider {
  return {
    id: provider.id,
    model: provider.model,
    dimensions,

    async embedQuery(text: string): Promise<number[]> {
      return provider.embedQuery(text);
    },

    async embedBatch(texts: string[]): Promise<number[][]> {
      return provider.embedBatch(texts);
    },

    async isAvailable(): Promise<boolean> {
      try {
        // Test with a simple embedding
        const result = await provider.embedQuery("test");
        return Array.isArray(result) && result.length === dimensions;
      } catch {
        return false;
      }
    },

    async close(): Promise<void> {
      // EmbeddingProvider doesn't have a close method
      // This is a no-op for OpenClaw providers
    },
  };
}
