/**
 * Anthropic Model Pricing Configuration
 *
 * Pricing as of 2025-02-04 from Anthropic's official pricing page
 * https://www.anthropic.com/pricing/claude
 *
 * All prices are in USD per 1 million tokens
 */

import type { ModelCostConfig } from "../utils/usage-format.js";

/**
 * Anthropic Claude model pricing configuration
 * Includes: input tokens, output tokens, cache read tokens, cache write tokens
 *
 * Cache pricing:
 * - Cache Read: 10% of input token price
 * - Cache Write: 25% of input token price
 */
export const ANTHROPIC_MODEL_PRICING: Record<string, ModelCostConfig> = {
  // Claude Opus 4.5 (Latest flagship model - Jan 2025)
  "claude-opus-4-5-20250514": {
    input: 15,
    output: 75,
    cacheRead: 1.5,
    cacheWrite: 3.75,
  },
  "claude-opus-4-5": {
    input: 15,
    output: 75,
    cacheRead: 1.5,
    cacheWrite: 3.75,
  },

  // Claude Opus 4 (Older version - keep for compatibility)
  "claude-opus-4-20250514": {
    input: 15,
    output: 75,
    cacheRead: 1.5,
    cacheWrite: 3.75,
  },
  "claude-opus-4-0": {
    input: 15,
    output: 75,
    cacheRead: 1.5,
    cacheWrite: 3.75,
  },

  // Claude Sonnet 4.5
  "claude-sonnet-4-5-20250929": {
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheWrite: 0.75,
  },
  "claude-sonnet-4-5": {
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheWrite: 0.75,
  },

  // Claude Sonnet 4 (Older version)
  "claude-sonnet-4-20250514": {
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheWrite: 0.75,
  },
  "claude-4-sonnet-20250514": {
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheWrite: 0.75,
  },

  // Claude 3.7 Sonnet Latest
  "claude-3-7-sonnet-latest": {
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheWrite: 0.75,
  },
  "claude-3-7-sonnet-20250219": {
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheWrite: 0.75,
  },

  // Claude 3.5 Sonnet Latest
  "claude-3-5-sonnet-latest": {
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheWrite: 0.75,
  },
  "claude-3-5-sonnet-20241022": {
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheWrite: 0.75,
  },

  // Claude Haiku 4.5 (Target model for this task)
  "claude-haiku-4-5-20251001": {
    input: 0.8,
    output: 4,
    cacheRead: 0.08,
    cacheWrite: 0.2,
  },
  "claude-haiku-4-5": {
    input: 0.8,
    output: 4,
    cacheRead: 0.08,
    cacheWrite: 0.2,
  },

  // Claude 3.5 Haiku Latest
  "claude-3-5-haiku-latest": {
    input: 0.8,
    output: 4,
    cacheRead: 0.08,
    cacheWrite: 0.2,
  },
  "claude-3-5-haiku-20241022": {
    input: 0.8,
    output: 4,
    cacheRead: 0.08,
    cacheWrite: 0.2,
  },

  // Claude 3 Haiku (Older version)
  "claude-3-haiku-20240307": {
    input: 0.25,
    output: 1.25,
    cacheRead: 0.025,
    cacheWrite: 0.0625,
  },

  // Claude 3 Opus Latest
  "claude-3-opus-latest": {
    input: 15,
    output: 75,
    cacheRead: 1.5,
    cacheWrite: 3.75,
  },
  "claude-3-opus-20240229": {
    input: 15,
    output: 75,
    cacheRead: 1.5,
    cacheWrite: 3.75,
  },
};

/**
 * Get pricing for a model ID (with fallback logic)
 *
 * @param modelId - The model ID (e.g., "claude-opus-4-5", "claude-haiku-4-5-20251001")
 * @returns ModelCostConfig with pricing, or undefined if model not found
 */
export function getAnthropicModelPricing(modelId: string): ModelCostConfig | undefined {
  const normalized = modelId.trim().toLowerCase();

  // Direct match
  if (ANTHROPIC_MODEL_PRICING[normalized]) {
    return ANTHROPIC_MODEL_PRICING[normalized];
  }

  // Family-level fallback: strip version suffix for fuzzy matching
  // e.g., "claude-opus-4-5-custom" → try "claude-opus-4-5"
  for (const [key, pricing] of Object.entries(ANTHROPIC_MODEL_PRICING)) {
    if (normalized.startsWith(key)) {
      return pricing;
    }
  }

  // Prefix matching for latest versions
  if (normalized.includes("haiku")) {
    return ANTHROPIC_MODEL_PRICING["claude-haiku-4-5"];
  }
  if (normalized.includes("sonnet")) {
    return ANTHROPIC_MODEL_PRICING["claude-sonnet-4-5"];
  }
  if (normalized.includes("opus")) {
    return ANTHROPIC_MODEL_PRICING["claude-opus-4-5"];
  }

  return undefined;
}

/**
 * All Anthropic model IDs with pricing configured
 */
export function getAnthropicModelIds(): string[] {
  return Object.keys(ANTHROPIC_MODEL_PRICING).sort();
}
