import type { CostUsageSummary } from "../../infra/session-cost-usage.js";
import type { GatewayRequestHandlers } from "./types.js";
import { loadConfig } from "../../config/config.js";
import { loadProviderUsageSummary } from "../../infra/provider-usage.js";
import { loadCostUsageSummary } from "../../infra/session-cost-usage.js";

const COST_USAGE_CACHE_TTL_MS = 30_000;

type CostUsageCacheKey = `${number}:${string}`;

type CostUsageCacheEntry = {
  summary?: CostUsageSummary;
  updatedAt?: number;
  inFlight?: Promise<CostUsageSummary>;
};

const costUsageCache = new Map<CostUsageCacheKey, CostUsageCacheEntry>();

const parseDays = (raw: unknown): number => {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.floor(raw);
  }
  if (typeof raw === "string" && raw.trim() !== "") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      return Math.floor(parsed);
    }
  }
  return 30;
};

const parseType = (raw: unknown): "daily" | "monthly" | "yearly" | "conversation" => {
  if (typeof raw !== "string") {
    return "daily";
  }
  const normalized = raw.toLowerCase().trim();
  if (normalized === "monthly" || normalized === "month") {
    return "monthly";
  }
  if (normalized === "yearly" || normalized === "year") {
    return "yearly";
  }
  if (normalized === "conversation" || normalized === "conv") {
    return "conversation";
  }
  return "daily";
};

async function loadCostUsageSummaryCached(params: {
  days: number;
  type?: "daily" | "monthly" | "yearly" | "conversation";
  config: ReturnType<typeof loadConfig>;
}): Promise<CostUsageSummary> {
  const days = Math.max(1, params.days);
  const type = params.type ?? "daily";
  const cacheKey: CostUsageCacheKey = `${days}:${type}`;
  const now = Date.now();
  const cached = costUsageCache.get(cacheKey);

  // Check if valid cached result exists
  if (cached?.summary && cached.updatedAt && now - cached.updatedAt < COST_USAGE_CACHE_TTL_MS) {
    return cached.summary;
  }

  // Reuse in-flight promise if available
  if (cached?.inFlight) {
    return await cached.inFlight;
  }

  // Start new load and cache it BEFORE the async operation
  const inFlight = loadCostUsageSummary({ days, type, config: params.config })
    .then((summary) => {
      costUsageCache.set(cacheKey, { summary, updatedAt: Date.now(), inFlight: undefined });
      return summary;
    })
    .catch((err) => {
      if (cached?.summary) return cached.summary;
      throw err;
    });

  // Set inFlight BEFORE awaiting to prevent race
  costUsageCache.set(cacheKey, { ...cached, inFlight });
  return await inFlight;
}

export const usageHandlers: GatewayRequestHandlers = {
  "usage.status": async ({ respond }) => {
    const summary = await loadProviderUsageSummary();
    respond(true, summary, undefined);
  },
  "usage.cost": async ({ respond, params }) => {
    const config = loadConfig();
    const days = parseDays(params?.days);
    const type = parseType(params?.type);
    const summary = await loadCostUsageSummaryCached({ days, config, type });
    respond(true, summary, undefined);
  },
};
