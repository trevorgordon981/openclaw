import { describe, it, expect } from "vitest";
import {
  ANTHROPIC_MODEL_PRICING,
  getAnthropicModelPricing,
  getAnthropicModelIds,
} from "./anthropic-models-pricing";

describe("Anthropic Models Pricing", () => {
  it("has pricing configured for claude-haiku-4-5-20251001", () => {
    const pricing = getAnthropicModelPricing("claude-haiku-4-5-20251001");
    expect(pricing).toBeDefined();
    expect(pricing?.input).toBe(0.8);
    expect(pricing?.output).toBe(4);
    expect(pricing?.cacheRead).toBe(0.08);
    expect(pricing?.cacheWrite).toBe(0.2);
  });

  it("has pricing configured for claude-opus-4-5", () => {
    const pricing = getAnthropicModelPricing("claude-opus-4-5");
    expect(pricing).toBeDefined();
    expect(pricing?.input).toBe(15);
    expect(pricing?.output).toBe(75);
    expect(pricing?.cacheRead).toBe(1.5);
    expect(pricing?.cacheWrite).toBe(3.75);
  });

  it("has pricing configured for claude-sonnet-4-5", () => {
    const pricing = getAnthropicModelPricing("claude-sonnet-4-5");
    expect(pricing).toBeDefined();
    expect(pricing?.input).toBe(3);
    expect(pricing?.output).toBe(15);
  });

  it("handles case-insensitive model IDs", () => {
    const pricing1 = getAnthropicModelPricing("CLAUDE-HAIKU-4-5");
    const pricing2 = getAnthropicModelPricing("claude-haiku-4-5");
    expect(pricing1).toEqual(pricing2);
  });

  it("falls back to family-level pricing for unknown version suffixes", () => {
    const pricing = getAnthropicModelPricing("claude-haiku-4-5-custom");
    expect(pricing).toBeDefined();
    expect(pricing?.input).toBe(0.8); // Falls back to claude-haiku-4-5
  });

  it("returns undefined for unknown models", () => {
    const pricing = getAnthropicModelPricing("claude-unknown-model");
    expect(pricing).toBeUndefined();
  });

  it("has all entries in ANTHROPIC_MODEL_PRICING", () => {
    expect(Object.keys(ANTHROPIC_MODEL_PRICING).length).toBeGreaterThan(0);
    for (const modelId of Object.keys(ANTHROPIC_MODEL_PRICING)) {
      const pricing = ANTHROPIC_MODEL_PRICING[modelId];
      expect(pricing.input).toBeGreaterThanOrEqual(0);
      expect(pricing.output).toBeGreaterThanOrEqual(0);
      expect(pricing.cacheRead).toBeGreaterThanOrEqual(0);
      expect(pricing.cacheWrite).toBeGreaterThanOrEqual(0);
    }
  });

  it("returns all model IDs sorted", () => {
    const ids = getAnthropicModelIds();
    expect(ids.length).toBeGreaterThan(0);
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
  });
});
