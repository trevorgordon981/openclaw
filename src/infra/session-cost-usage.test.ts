import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import {
  loadCostUsageSummary,
  loadSessionCostSummary,
  loadConversationCostSummary,
} from "./session-cost-usage.js";

describe("session cost usage", () => {
  it("aggregates daily totals with log cost and pricing fallback", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-cost-"));
    const sessionsDir = path.join(root, "agents", "main", "sessions");
    await fs.mkdir(sessionsDir, { recursive: true });
    const sessionFile = path.join(sessionsDir, "sess-1.jsonl");

    const now = new Date();
    const older = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);

    const entries = [
      {
        type: "message",
        timestamp: now.toISOString(),
        message: {
          role: "assistant",
          provider: "openai",
          model: "gpt-5.2",
          usage: {
            input: 10,
            output: 20,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 30,
            cost: { total: 0.03 },
          },
        },
      },
      {
        type: "message",
        timestamp: now.toISOString(),
        message: {
          role: "assistant",
          provider: "openai",
          model: "gpt-5.2",
          usage: {
            input: 10,
            output: 10,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 20,
          },
        },
      },
      {
        type: "message",
        timestamp: older.toISOString(),
        message: {
          role: "assistant",
          provider: "openai",
          model: "gpt-5.2",
          usage: {
            input: 5,
            output: 5,
            totalTokens: 10,
            cost: { total: 0.01 },
          },
        },
      },
    ];

    await fs.writeFile(
      sessionFile,
      entries.map((entry) => JSON.stringify(entry)).join("\n"),
      "utf-8",
    );

    const config = {
      models: {
        providers: {
          openai: {
            models: [
              {
                id: "gpt-5.2",
                cost: {
                  input: 1,
                  output: 2,
                  cacheRead: 0,
                  cacheWrite: 0,
                },
              },
            ],
          },
        },
      },
    } as OpenClawConfig;

    const originalState = process.env.OPENCLAW_STATE_DIR;
    process.env.OPENCLAW_STATE_DIR = root;
    try {
      const summary = await loadCostUsageSummary({ days: 30, config });
      expect(summary.daily.length).toBe(1);
      expect(summary.totals.totalTokens).toBe(50);
      expect(summary.totals.totalCost).toBeCloseTo(0.03003, 5);
    } finally {
      if (originalState === undefined) {
        delete process.env.OPENCLAW_STATE_DIR;
      } else {
        process.env.OPENCLAW_STATE_DIR = originalState;
      }
    }
  });

  it("summarizes a single session file", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-cost-session-"));
    const sessionFile = path.join(root, "session.jsonl");
    const now = new Date();

    await fs.writeFile(
      sessionFile,
      JSON.stringify({
        type: "message",
        timestamp: now.toISOString(),
        message: {
          role: "assistant",
          provider: "openai",
          model: "gpt-5.2",
          usage: {
            input: 10,
            output: 20,
            totalTokens: 30,
            cost: { total: 0.03 },
          },
        },
      }),
      "utf-8",
    );

    const summary = await loadSessionCostSummary({
      sessionFile,
    });
    expect(summary?.totalCost).toBeCloseTo(0.03, 5);
    expect(summary?.totalTokens).toBe(30);
    expect(summary?.lastActivity).toBeGreaterThan(0);
  });

  it("aggregates monthly costs", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-cost-monthly-"));
    const sessionsDir = path.join(root, "agents", "main", "sessions");
    await fs.mkdir(sessionsDir, { recursive: true });
    const sessionFile = path.join(sessionsDir, "sess-1.jsonl");

    const jan1 = new Date("2024-01-15");
    const feb1 = new Date("2024-02-15");

    const entries = [
      {
        type: "message",
        timestamp: jan1.toISOString(),
        message: {
          role: "assistant",
          provider: "openai",
          model: "gpt-5.2",
          usage: {
            input: 10,
            output: 20,
            totalTokens: 30,
            cost: { total: 0.03 },
          },
        },
      },
      {
        type: "message",
        timestamp: feb1.toISOString(),
        message: {
          role: "assistant",
          provider: "openai",
          model: "gpt-5.2",
          usage: {
            input: 5,
            output: 10,
            totalTokens: 15,
            cost: { total: 0.015 },
          },
        },
      },
    ];

    await fs.writeFile(
      sessionFile,
      entries.map((entry) => JSON.stringify(entry)).join("\n"),
      "utf-8",
    );

    const originalState = process.env.OPENCLAW_STATE_DIR;
    process.env.OPENCLAW_STATE_DIR = root;
    try {
      const summary = await loadCostUsageSummary({
        days: 365,
        type: "monthly",
        config: {} as OpenClawConfig,
      });
      expect(summary.monthly).toBeDefined();
      expect(summary.monthly?.length).toBe(2);
      expect(summary.monthly?.[0]?.month).toMatch(/2024-01/);
      expect(summary.monthly?.[1]?.month).toMatch(/2024-02/);
      expect(summary.totals.totalCost).toBeCloseTo(0.045, 5);
    } finally {
      if (originalState === undefined) {
        delete process.env.OPENCLAW_STATE_DIR;
      } else {
        process.env.OPENCLAW_STATE_DIR = originalState;
      }
    }
  });

  it("aggregates yearly costs", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-cost-yearly-"));
    const sessionsDir = path.join(root, "agents", "main", "sessions");
    await fs.mkdir(sessionsDir, { recursive: true });
    const sessionFile = path.join(sessionsDir, "sess-1.jsonl");

    const date2024 = new Date("2024-06-15");
    const date2025 = new Date("2025-06-15");

    const entries = [
      {
        type: "message",
        timestamp: date2024.toISOString(),
        message: {
          role: "assistant",
          provider: "openai",
          model: "gpt-5.2",
          usage: {
            input: 10,
            output: 20,
            totalTokens: 30,
            cost: { total: 0.03 },
          },
        },
      },
      {
        type: "message",
        timestamp: date2025.toISOString(),
        message: {
          role: "assistant",
          provider: "openai",
          model: "gpt-5.2",
          usage: {
            input: 5,
            output: 10,
            totalTokens: 15,
            cost: { total: 0.015 },
          },
        },
      },
    ];

    await fs.writeFile(
      sessionFile,
      entries.map((entry) => JSON.stringify(entry)).join("\n"),
      "utf-8",
    );

    const originalState = process.env.OPENCLAW_STATE_DIR;
    process.env.OPENCLAW_STATE_DIR = root;
    try {
      const summary = await loadCostUsageSummary({
        days: 730,
        type: "yearly",
        config: {} as OpenClawConfig,
      });
      expect(summary.yearly).toBeDefined();
      expect(summary.yearly?.length).toBe(2);
      expect(summary.yearly?.[0]?.year).toBe("2024");
      expect(summary.yearly?.[1]?.year).toBe("2025");
      expect(summary.totals.totalCost).toBeCloseTo(0.045, 5);
    } finally {
      if (originalState === undefined) {
        delete process.env.OPENCLAW_STATE_DIR;
      } else {
        process.env.OPENCLAW_STATE_DIR = originalState;
      }
    }
  });

  it("extracts per-message conversation costs", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-cost-conversation-"));
    const sessionFile = path.join(root, "session.jsonl");
    const now = new Date();

    const entries = [
      {
        type: "message",
        timestamp: now.toISOString(),
        message: {
          role: "assistant",
          provider: "openai",
          model: "gpt-5.2",
          usage: {
            input: 10,
            output: 20,
            totalTokens: 30,
            cost: { total: 0.03 },
          },
        },
      },
      {
        type: "message",
        timestamp: new Date(now.getTime() + 1000).toISOString(),
        message: {
          role: "assistant",
          provider: "openai",
          model: "gpt-5.2",
          usage: {
            input: 5,
            output: 10,
            totalTokens: 15,
            cost: { total: 0.015 },
          },
        },
      },
    ];

    await fs.writeFile(
      sessionFile,
      entries.map((entry) => JSON.stringify(entry)).join("\n"),
      "utf-8",
    );

    const summary = await loadConversationCostSummary({ sessionFile });
    expect(summary.conversation).toBeDefined();
    expect(summary.conversation?.length).toBe(2);
    expect(summary.conversation?.[0]?.messageIndex).toBe(0);
    expect(summary.conversation?.[1]?.messageIndex).toBe(1);
    expect(summary.conversation?.[0]?.totalCost).toBeCloseTo(0.03, 5);
    expect(summary.conversation?.[1]?.totalCost).toBeCloseTo(0.015, 5);
    expect(summary.totals.totalCost).toBeCloseTo(0.045, 5);
  });
});
