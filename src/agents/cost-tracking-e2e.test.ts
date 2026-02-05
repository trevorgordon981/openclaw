/**
 * End-to-End Cost Tracking Test
 *
 * Demonstrates the complete cost tracking system working together:
 * 1. Pricing configuration and lookup
 * 2. Model enrichment with pricing
 * 3. Cost calculation from token usage
 * 4. Cost display formatting
 */

import { describe, it, expect } from "vitest";
import type { ModelDefinitionConfig } from "../config/types.models";
import { estimateUsageCost, formatUsd } from "../utils/usage-format";
import { getAnthropicModelPricing } from "./anthropic-models-pricing";
import { resolvePricingForModel, enrichModelWithPricing } from "./model-pricing-enrichment";

describe("Cost Tracking End-to-End", () => {
  describe("1. Pricing Configuration", () => {
    it("provides pricing for all major Anthropic models", () => {
      const models = ["claude-haiku-4-5-20251001", "claude-sonnet-4-5", "claude-opus-4-5"];

      for (const model of models) {
        const pricing = getAnthropicModelPricing(model);
        expect(pricing).toBeDefined();
        expect(pricing?.input).toBeGreaterThan(0);
        expect(pricing?.output).toBeGreaterThan(0);
      }
    });

    it("returns pricing for haiku model specifically", () => {
      const haiku = getAnthropicModelPricing("claude-haiku-4-5-20251001");
      expect(haiku).toEqual({
        input: 0.8,
        output: 4,
        cacheRead: 0.08,
        cacheWrite: 0.2,
      });
    });
  });

  describe("2. Model Enrichment", () => {
    it("enriches models with pricing information", () => {
      const baseModel: ModelDefinitionConfig = {
        id: "claude-haiku-4-5",
        name: "Claude Haiku 4.5",
        api: "anthropic-messages",
        input: ["text"],
      };

      const enriched = enrichModelWithPricing(baseModel, "anthropic");

      expect(enriched.cost).toBeDefined();
      expect(enriched.cost?.input).toBe(0.8);
      expect(enriched.cost?.output).toBe(4);
    });

    it("resolves pricing for any provider/model combination", () => {
      // Anthropic
      const anthropicPricing = resolvePricingForModel("anthropic", "claude-opus-4-5");
      expect(anthropicPricing).toBeDefined();
      expect(anthropicPricing?.input).toBe(15);

      // Google
      const googlePricing = resolvePricingForModel("google", "gemini-2.0-flash");
      expect(googlePricing).toBeDefined();
      expect(googlePricing?.input).toBe(0.075);

      // Unknown provider
      const unknownPricing = resolvePricingForModel("unknown-provider", "some-model");
      expect(unknownPricing).toBeUndefined();
    });
  });

  describe("3. Cost Calculation", () => {
    it("calculates cost for haiku model usage", () => {
      const pricing = getAnthropicModelPricing("claude-haiku-4-5");
      const cost = estimateUsageCost({
        usage: {
          input: 1000,
          output: 500,
        },
        cost: pricing,
      });

      // (1000 * 0.8 + 500 * 4) / 1000000 = 2800 / 1000000 = 0.0028
      expect(cost).toBeCloseTo(0.0028, 5);
    });

    it("calculates cost for opus model usage", () => {
      const pricing = getAnthropicModelPricing("claude-opus-4-5");
      const cost = estimateUsageCost({
        usage: {
          input: 10000,
          output: 2000,
        },
        cost: pricing,
      });

      // (10000 * 15 + 2000 * 75) / 1000000 = 300000 / 1000000 = 0.30
      expect(cost).toBeCloseTo(0.3, 5);
    });

    it("includes cache read and write costs when provided", () => {
      const pricing = getAnthropicModelPricing("claude-haiku-4-5");
      const cost = estimateUsageCost({
        usage: {
          input: 1000,
          output: 500,
          cacheRead: 2000,
          cacheWrite: 500,
        },
        cost: pricing,
      });

      // (1000 * 0.8 + 500 * 4 + 2000 * 0.08 + 500 * 0.2) / 1000000
      // = (800 + 2000 + 160 + 100) / 1000000
      // = 3060 / 1000000 = 0.00306
      expect(cost).toBeCloseTo(0.00306, 5);
    });
  });

  describe("4. Cost Formatting", () => {
    it("formats costs with dollar sign and appropriate precision", () => {
      expect(formatUsd(0.0028)).toBe("$0.0028");
      expect(formatUsd(0.3)).toBe("$0.30");
      expect(formatUsd(5.25)).toBe("$5.25");
      expect(formatUsd(1234.56)).toBe("$1234.56");
    });

    it("returns undefined for invalid costs", () => {
      expect(formatUsd(undefined)).toBeUndefined();
      expect(formatUsd(NaN)).toBeUndefined();
      expect(formatUsd(Infinity)).toBeUndefined();
    });
  });

  describe("5. Complete Pipeline", () => {
    it("processes a conversation from pricing to formatted output", () => {
      // Step 1: Get model definition
      const model: ModelDefinitionConfig = {
        id: "claude-haiku-4-5-20251001",
        name: "Claude Haiku 4.5",
        api: "anthropic-messages",
        input: ["text"],
      };

      // Step 2: Enrich with pricing
      const enriched = enrichModelWithPricing(model, "anthropic");
      expect(enriched.cost).toBeDefined();

      // Step 3: Simulate token usage from conversation
      const usage = {
        input: 2500, // Typical conversation input
        output: 1200, // Typical response output
      };

      // Step 4: Calculate cost
      const cost = estimateUsageCost({
        usage,
        cost: enriched.cost!,
      });

      // (2500 * 0.8 + 1200 * 4) / 1000000 = 6800 / 1000000 = 0.0068
      expect(cost).toBeCloseTo(0.0068, 5);

      // Step 5: Format for display
      const formatted = formatUsd(cost);
      expect(formatted).toBe("$0.0068");

      // Expected output format
      const statusLine = `💵 Cost: ${formatted}`;
      expect(statusLine).toBe("💵 Cost: $0.0068");
    });

    it("handles realistic multi-turn conversation scenario", () => {
      // Simulate a 5-turn conversation with Opus
      const turns = [
        { input: 500, output: 200 },
        { input: 800, output: 350 },
        { input: 600, output: 280 },
        { input: 900, output: 420 },
        { input: 700, output: 300 },
      ];

      const opusPricing = getAnthropicModelPricing("claude-opus-4-5");
      let totalCost = 0;
      let totalInputTokens = 0;
      let totalOutputTokens = 0;

      for (const turn of turns) {
        totalInputTokens += turn.input;
        totalOutputTokens += turn.output;
        const turnCost = estimateUsageCost({
          usage: turn,
          cost: opusPricing,
        });
        totalCost += turnCost ?? 0;
      }

      // Verify calculation
      const expectedCost = estimateUsageCost({
        usage: {
          input: totalInputTokens,
          output: totalOutputTokens,
        },
        cost: opusPricing,
      });

      expect(totalCost).toBeCloseTo(expectedCost ?? 0, 5);
      expect(totalInputTokens).toBe(3500);
      expect(totalOutputTokens).toBe(1550);

      // Total cost should be approximately (3500 * 15 + 1550 * 75) / 1000000 = 0.1395
      expect(totalCost).toBeCloseTo(0.1395, 4);

      const formatted = formatUsd(totalCost);
      expect(formatted).toBe("$0.1395");
    });
  });

  describe("6. Session Status Integration", () => {
    it("formats cost for status display", () => {
      const pricing = getAnthropicModelPricing("claude-haiku-4-5");
      const cost = estimateUsageCost({
        usage: { input: 1000, output: 500 },
        cost: pricing,
      });

      const costFormatted = formatUsd(cost);
      const costLine = costFormatted ? `💵 Cost: ${costFormatted}` : undefined;

      expect(costLine).toBe("💵 Cost: $0.0028");

      // Simulate full status output
      const statusOutput = [
        "🦞 OpenClaw 2026.2.3",
        "🧠 Model: anthropic/claude-haiku-4-5",
        "🧮 Tokens: 1.0k in / 500 out · " + costLine,
        "🧵 Session: active",
      ].join("\n");

      expect(statusOutput).toContain("💵 Cost: $0.0028");
    });
  });
});
