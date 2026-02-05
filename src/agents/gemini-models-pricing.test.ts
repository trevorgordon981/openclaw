import { describe, it, expect } from "vitest";
import {
  GEMINI_MODEL_PRICING,
  getGeminiModelPricing,
  getGeminiModelIds,
  calculateGeminiCost,
} from "./gemini-models-pricing";

describe("Gemini Models Pricing", () => {
  it("has pricing configured for gemini-2.0-flash", () => {
    const pricing = getGeminiModelPricing("gemini-2.0-flash");
    expect(pricing).toBeDefined();
    expect(pricing?.input).toBe(0.075);
    expect(pricing?.output).toBe(0.3);
  });

  it("has pricing configured for gemini-1.5-pro", () => {
    const pricing = getGeminiModelPricing("gemini-1.5-pro");
    expect(pricing).toBeDefined();
    expect(pricing?.input).toBe(1.25);
    expect(pricing?.output).toBe(5.0);
  });

  it("has pricing configured for gemini-1.5-flash", () => {
    const pricing = getGeminiModelPricing("gemini-1.5-flash");
    expect(pricing).toBeDefined();
    expect(pricing?.input).toBe(0.075);
    expect(pricing?.output).toBe(0.3);
  });

  it("handles case-insensitive model IDs", () => {
    const pricing1 = getGeminiModelPricing("GEMINI-2.0-FLASH");
    const pricing2 = getGeminiModelPricing("gemini-2.0-flash");
    expect(pricing1).toEqual(pricing2);
  });

  it("falls back to family-level pricing for version suffixes", () => {
    const pricing = getGeminiModelPricing("gemini-2.0-flash-001");
    expect(pricing).toBeDefined();
    expect(pricing?.input).toBe(0.075); // Falls back to gemini-2.0-flash
  });

  it("returns undefined for unknown models", () => {
    const pricing = getGeminiModelPricing("gemini-unknown-model");
    expect(pricing).toBeUndefined();
  });

  it("calculates cost correctly for gemini-2.0-flash", () => {
    const cost = calculateGeminiCost("gemini-2.0-flash", 1_000_000, 500_000);
    expect(cost).toBe(0.075 + 0.15); // $0.225
  });

  it("calculates cost correctly for gemini-1.5-pro", () => {
    const cost = calculateGeminiCost("gemini-1.5-pro", 1_000_000, 1_000_000);
    expect(cost).toBe(1.25 + 5.0); // $6.25
  });

  it("returns undefined cost for unknown model", () => {
    const cost = calculateGeminiCost("gemini-unknown", 1_000_000, 500_000);
    expect(cost).toBeUndefined();
  });

  it("has all entries in GEMINI_MODEL_PRICING", () => {
    expect(Object.keys(GEMINI_MODEL_PRICING).length).toBeGreaterThan(0);
    for (const modelId of Object.keys(GEMINI_MODEL_PRICING)) {
      const pricing = GEMINI_MODEL_PRICING[modelId];
      expect(pricing.input).toBeGreaterThanOrEqual(0);
      expect(pricing.output).toBeGreaterThanOrEqual(0);
    }
  });

  it("returns all model IDs sorted", () => {
    const ids = getGeminiModelIds();
    expect(ids.length).toBeGreaterThan(0);
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
  });
});
