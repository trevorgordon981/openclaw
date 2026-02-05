/**
 * Model Pricing Enrichment
 *
 * Enriches discovered models with cost/pricing information based on provider and model ID
 */

import type { ModelDefinitionConfig } from "../config/types.models.js";
import type { ModelCostConfig } from "../utils/usage-format.js";
import { getAnthropicModelPricing } from "./anthropic-models-pricing.js";

/**
 * Get pricing for a model based on provider and model ID
 *
 * @param provider - The provider name (e.g., "anthropic", "openai", "google")
 * @param modelId - The model ID
 * @returns ModelCostConfig if pricing is available, undefined otherwise
 */
export function resolvePricingForModel(
  provider: string,
  modelId: string,
): ModelCostConfig | undefined {
  const normalizedProvider = provider.toLowerCase().trim();
  const normalizedModelId = modelId.toLowerCase().trim();

  // Anthropic models
  if (normalizedProvider === "anthropic") {
    return getAnthropicModelPricing(normalizedModelId);
  }

  // OpenAI models (can be added later)
  // Google models (can be added later)
  // etc.

  return undefined;
}

/**
 * Enrich a model definition with pricing information
 *
 * @param model - The model definition to enrich
 * @param provider - The provider name
 * @returns The enriched model definition
 */
export function enrichModelWithPricing(
  model: ModelDefinitionConfig,
  provider: string,
): ModelDefinitionConfig {
  // Skip if already has pricing
  if (model.cost) {
    return model;
  }

  const pricing = resolvePricingForModel(provider, model.id);
  if (!pricing) {
    return model;
  }

  return {
    ...model,
    cost: pricing,
  };
}

/**
 * Enrich an array of models with pricing information
 *
 * @param models - The array of models
 * @param provider - The provider name
 * @returns Array of enriched models
 */
export function enrichModelsWithPricing(
  models: ModelDefinitionConfig[],
  provider: string,
): ModelDefinitionConfig[] {
  return models.map((model) => enrichModelWithPricing(model, provider));
}
