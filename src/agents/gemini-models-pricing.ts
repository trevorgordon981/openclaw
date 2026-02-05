/**
 * Google Gemini Model Pricing (as of 2026-02-04)
 * Prices in USD per 1M tokens
 * Source: https://ai.google.dev/pricing
 */

export interface GeminiModelPricing {
  input: number; // USD per 1M input tokens
  output: number; // USD per 1M output tokens
  cacheRead?: number; // USD per 1M cached tokens read (if applicable)
  cacheWrite?: number; // USD per 1M cached tokens write (if applicable)
}

export const GEMINI_MODEL_PRICING: Record<string, GeminiModelPricing> = {
  // Gemini 2.0 Flash - Fastest, most cost-effective
  "gemini-2.0-flash": {
    input: 0.075,
    output: 0.3,
  },

  // Gemini 1.5 Pro - Most capable
  "gemini-1.5-pro": {
    input: 1.25,
    output: 5.0,
  },

  // Gemini 1.5 Flash - Balanced performance and cost
  "gemini-1.5-flash": {
    input: 0.075,
    output: 0.3,
  },

  // Legacy models (if needed)
  "gemini-1.0-pro": {
    input: 0.5,
    output: 1.5,
  },
};

/**
 * Get pricing for a specific Gemini model
 * Handles case-insensitive lookups and partial matches
 */
export function getGeminiModelPricing(modelId: string): GeminiModelPricing | undefined {
  if (!modelId) {
    return undefined;
  }

  const normalizedId = modelId.toLowerCase().trim();

  // Direct lookup
  if (normalizedId in GEMINI_MODEL_PRICING) {
    return GEMINI_MODEL_PRICING[normalizedId as keyof typeof GEMINI_MODEL_PRICING];
  }

  // Family-level fallback (e.g., "gemini-2.0-flash-001" -> "gemini-2.0-flash")
  const parts = normalizedId.split("-");
  if (parts.length > 3) {
    const familyId = parts.slice(0, 3).join("-");
    if (familyId in GEMINI_MODEL_PRICING) {
      return GEMINI_MODEL_PRICING[familyId as keyof typeof GEMINI_MODEL_PRICING];
    }
  }

  return undefined;
}

/**
 * Get all configured Gemini model IDs (sorted)
 */
export function getGeminiModelIds(): string[] {
  return Object.keys(GEMINI_MODEL_PRICING).sort();
}

/**
 * Calculate cost for Gemini model usage
 */
export function calculateGeminiCost(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): number | undefined {
  const pricing = getGeminiModelPricing(modelId);
  if (!pricing) {
    return undefined;
  }

  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;

  return inputCost + outputCost;
}
