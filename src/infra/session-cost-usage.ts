import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import type { NormalizedUsage, UsageLike } from "../agents/usage.js";
import type { OpenClawConfig } from "../config/config.js";
import type { SessionEntry } from "../config/sessions/types.js";
import { normalizeUsage } from "../agents/usage.js";
import {
  resolveSessionFilePath,
  resolveSessionTranscriptsDirForAgent,
} from "../config/sessions/paths.js";
import { estimateUsageCost, resolveModelCostConfig } from "../utils/usage-format.js";

type ParsedUsageEntry = {
  usage: NormalizedUsage;
  costTotal?: number;
  isEstimatedCost?: boolean; // Track whether cost was estimated or real
  provider?: string;
  model?: string;
  timestamp?: Date;
  messageIndex?: number;
};

export type CostUsageTotals = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  totalCost: number;
  missingCostEntries: number;

  // New fields for cost estimation tracking
  estimatedCostAmount?: number; // Sum of estimated costs
  estimationAccuracy?: {
    // Comparison to real costs
    realCostCount: number;
    estimatedCount: number;
    totalDeviation: number; // Sum of |estimated - real|
  };
};

export type CostUsageDailyEntry = CostUsageTotals & {
  date: string;
};

export type CostUsageMonthlyEntry = CostUsageTotals & {
  month: string; // YYYY-MM format
};

export type CostUsageYearlyEntry = CostUsageTotals & {
  year: string; // YYYY format
};

export type ConversationCostEntry = CostUsageTotals & {
  messageIndex: number;
  timestamp: number;
};

export type CostUsageSummary = {
  updatedAt: number;
  days?: number;
  daily?: CostUsageDailyEntry[];
  monthly?: CostUsageMonthlyEntry[];
  yearly?: CostUsageYearlyEntry[];
  conversation?: ConversationCostEntry[];
  totals: CostUsageTotals;
};

export type SessionCostSummary = CostUsageTotals & {
  sessionId?: string;
  sessionFile?: string;
  lastActivity?: number;
};

const emptyTotals = (): CostUsageTotals => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  totalCost: 0,
  missingCostEntries: 0,
  estimatedCostAmount: 0,
  estimationAccuracy: {
    realCostCount: 0,
    estimatedCount: 0,
    totalDeviation: 0,
  },
});

const toFiniteNumber = (value: unknown): number | undefined => {
  if (typeof value !== "number") {
    return undefined;
  }
  if (!Number.isFinite(value)) {
    return undefined;
  }
  return value;
};

const extractCostTotal = (usageRaw?: UsageLike | null): number | undefined => {
  if (!usageRaw || typeof usageRaw !== "object") {
    return undefined;
  }
  const record = usageRaw as Record<string, unknown>;
  const cost = record.cost as Record<string, unknown> | undefined;
  const total = toFiniteNumber(cost?.total);
  if (total === undefined) {
    return undefined;
  }
  if (total < 0) {
    return undefined;
  }
  return total;
};

const parseTimestamp = (entry: Record<string, unknown>): Date | undefined => {
  const raw = entry.timestamp;
  if (typeof raw === "string") {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.valueOf())) {
      return parsed;
    }
  }
  const message = entry.message as Record<string, unknown> | undefined;
  const messageTimestamp = toFiniteNumber(message?.timestamp);
  if (messageTimestamp !== undefined) {
    const parsed = new Date(messageTimestamp);
    if (!Number.isNaN(parsed.valueOf())) {
      return parsed;
    }
  }
  return undefined;
};

const parseUsageEntry = (entry: Record<string, unknown>): ParsedUsageEntry | null => {
  const message = entry.message as Record<string, unknown> | undefined;
  const role = message?.role;
  if (role !== "assistant") {
    return null;
  }

  const usageRaw =
    (message?.usage as UsageLike | undefined) ?? (entry.usage as UsageLike | undefined);
  const usage = normalizeUsage(usageRaw);
  if (!usage) {
    return null;
  }

  const provider =
    (typeof message?.provider === "string" ? message?.provider : undefined) ??
    (typeof entry.provider === "string" ? entry.provider : undefined);
  const model =
    (typeof message?.model === "string" ? message?.model : undefined) ??
    (typeof entry.model === "string" ? entry.model : undefined);

  return {
    usage,
    costTotal: extractCostTotal(usageRaw),
    provider,
    model,
    timestamp: parseTimestamp(entry),
  };
};

const formatDayKey = (date: Date): string =>
  date.toLocaleDateString("en-CA", { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });

const formatMonthKey = (date: Date): string => {
  const yearMonth = date.toLocaleDateString("en-CA", {
    year: "numeric",
    month: "2-digit",
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  // Returns YYYY-MM-DD, we want just YYYY-MM
  return yearMonth.slice(0, 7);
};

const formatYearKey = (date: Date): string =>
  date.toLocaleDateString("en-CA", {
    year: "numeric",
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });

const applyUsageTotals = (totals: CostUsageTotals, usage: NormalizedUsage) => {
  totals.input += usage.input ?? 0;
  totals.output += usage.output ?? 0;
  totals.cacheRead += usage.cacheRead ?? 0;
  totals.cacheWrite += usage.cacheWrite ?? 0;
  const totalTokens =
    usage.total ??
    (usage.input ?? 0) + (usage.output ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
  totals.totalTokens += totalTokens;
};

const applyCostTotal = (
  totals: CostUsageTotals,
  costTotal: number | undefined,
  isEstimated?: boolean,
) => {
  if (costTotal === undefined) {
    totals.missingCostEntries += 1;
    return;
  }
  totals.totalCost += costTotal;

  // Track estimation accuracy
  if (isEstimated) {
    totals.estimatedCostAmount = (totals.estimatedCostAmount ?? 0) + costTotal;
    if (totals.estimationAccuracy) {
      totals.estimationAccuracy.estimatedCount += 1;
    }
  } else {
    if (totals.estimationAccuracy) {
      totals.estimationAccuracy.realCostCount += 1;
    }
  }
};

async function scanUsageFile(params: {
  filePath: string;
  config?: OpenClawConfig;
  onEntry: (entry: ParsedUsageEntry) => void;
}): Promise<void> {
  const fileStream = fs.createReadStream(params.filePath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let messageIndex = 0;
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const entry = parseUsageEntry(parsed);
      if (!entry) {
        continue;
      }

      const hadRealCost = entry.costTotal !== undefined;
      if (entry.costTotal === undefined) {
        const cost = resolveModelCostConfig({
          provider: entry.provider,
          model: entry.model,
          config: params.config,
        });
        entry.costTotal = estimateUsageCost({ usage: entry.usage, cost });
        entry.isEstimatedCost = true; // Mark as estimated
      } else {
        entry.isEstimatedCost = false; // Real cost from API
      }

      entry.messageIndex = messageIndex++;
      params.onEntry(entry);
    } catch {
      // Ignore malformed lines
    }
  }
}

type CostAggregationType = "daily" | "monthly" | "yearly" | "conversation";

export async function loadCostUsageSummary(params?: {
  days?: number;
  type?: CostAggregationType;
  config?: OpenClawConfig;
  agentId?: string;
  sessionId?: string;
  sessionFile?: string;
}): Promise<CostUsageSummary> {
  const type = params?.type ?? "daily";
  const days = Math.max(1, Math.floor(params?.days ?? 30));
  const now = new Date();
  const since = new Date(now);
  since.setDate(since.getDate() - (days - 1));
  const sinceTime = since.getTime();

  const totals = emptyTotals();

  // For conversation aggregation, use specific session file
  if (type === "conversation" && (params?.sessionId || params?.sessionFile)) {
    return loadConversationCostSummary({
      sessionId: params.sessionId,
      sessionFile: params.sessionFile,
      config: params.config,
    });
  }

  const sessionsDir = resolveSessionTranscriptsDirForAgent(params?.agentId);
  const entries = await fs.promises.readdir(sessionsDir, { withFileTypes: true }).catch(() => []);
  const files = (
    await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
        .map(async (entry) => {
          const filePath = path.join(sessionsDir, entry.name);
          const stats = await fs.promises.stat(filePath).catch(() => null);
          if (!stats) {
            return null;
          }
          if (stats.mtimeMs < sinceTime) {
            return null;
          }
          return filePath;
        }),
    )
  ).filter((filePath): filePath is string => Boolean(filePath));

  if (type === "daily") {
    const dailyMap = new Map<string, CostUsageTotals>();

    for (const filePath of files) {
      await scanUsageFile({
        filePath,
        config: params?.config,
        onEntry: (entry) => {
          const ts = entry.timestamp?.getTime();
          if (!ts || ts < sinceTime) {
            return;
          }
          const dayKey = formatDayKey(entry.timestamp ?? now);
          const bucket = dailyMap.get(dayKey) ?? emptyTotals();
          applyUsageTotals(bucket, entry.usage);
          applyCostTotal(bucket, entry.costTotal, entry.isEstimatedCost);
          dailyMap.set(dayKey, bucket);

          applyUsageTotals(totals, entry.usage);
          applyCostTotal(totals, entry.costTotal, entry.isEstimatedCost);
        },
      });
    }

    const daily = Array.from(dailyMap.entries())
      .map(([date, bucket]) => Object.assign({ date }, bucket))
      .toSorted((a, b) => a.date.localeCompare(b.date));

    return {
      updatedAt: Date.now(),
      days,
      daily,
      totals,
    };
  }

  if (type === "monthly") {
    const monthlyMap = new Map<string, CostUsageTotals>();

    for (const filePath of files) {
      await scanUsageFile({
        filePath,
        config: params?.config,
        onEntry: (entry) => {
          const ts = entry.timestamp?.getTime();
          if (!ts || ts < sinceTime) {
            return;
          }
          const monthKey = formatMonthKey(entry.timestamp ?? now);
          const bucket = monthlyMap.get(monthKey) ?? emptyTotals();
          applyUsageTotals(bucket, entry.usage);
          applyCostTotal(bucket, entry.costTotal, entry.isEstimatedCost);
          monthlyMap.set(monthKey, bucket);

          applyUsageTotals(totals, entry.usage);
          applyCostTotal(totals, entry.costTotal, entry.isEstimatedCost);
        },
      });
    }

    const monthly = Array.from(monthlyMap.entries())
      .map(([month, bucket]) => Object.assign({ month }, bucket))
      .toSorted((a, b) => a.month.localeCompare(b.month));

    return {
      updatedAt: Date.now(),
      days,
      monthly,
      totals,
    };
  }

  if (type === "yearly") {
    const yearlyMap = new Map<string, CostUsageTotals>();

    for (const filePath of files) {
      await scanUsageFile({
        filePath,
        config: params?.config,
        onEntry: (entry) => {
          const ts = entry.timestamp?.getTime();
          if (!ts || ts < sinceTime) {
            return;
          }
          const yearKey = formatYearKey(entry.timestamp ?? now);
          const bucket = yearlyMap.get(yearKey) ?? emptyTotals();
          applyUsageTotals(bucket, entry.usage);
          applyCostTotal(bucket, entry.costTotal, entry.isEstimatedCost);
          yearlyMap.set(yearKey, bucket);

          applyUsageTotals(totals, entry.usage);
          applyCostTotal(totals, entry.costTotal, entry.isEstimatedCost);
        },
      });
    }

    const yearly = Array.from(yearlyMap.entries())
      .map(([year, bucket]) => Object.assign({ year }, bucket))
      .toSorted((a, b) => a.year.localeCompare(b.year));

    return {
      updatedAt: Date.now(),
      days,
      yearly,
      totals,
    };
  }

  return {
    updatedAt: Date.now(),
    days,
    totals,
  };
}

export async function loadConversationCostSummary(params: {
  sessionId?: string;
  sessionFile?: string;
  config?: OpenClawConfig;
}): Promise<CostUsageSummary> {
  const sessionFile =
    params.sessionFile ??
    (params.sessionId ? resolveSessionFilePath(params.sessionId, undefined) : undefined);

  const totals = emptyTotals();
  const conversation: ConversationCostEntry[] = [];

  if (sessionFile && fs.existsSync(sessionFile)) {
    await scanUsageFile({
      filePath: sessionFile,
      config: params.config,
      onEntry: (entry) => {
        applyUsageTotals(totals, entry.usage);
        applyCostTotal(totals, entry.costTotal, entry.isEstimatedCost);

        if (entry.timestamp && entry.messageIndex !== undefined) {
          const ts = entry.timestamp.getTime();
          const conversationEntry: ConversationCostEntry = {
            ...emptyTotals(),
            messageIndex: entry.messageIndex,
            timestamp: ts,
          };
          applyUsageTotals(conversationEntry, entry.usage);
          applyCostTotal(conversationEntry, entry.costTotal, entry.isEstimatedCost);
          conversation.push(conversationEntry);
        }
      },
    });
  }

  return {
    updatedAt: Date.now(),
    conversation,
    totals,
  };
}

export async function loadSessionCostSummary(params: {
  sessionId?: string;
  sessionEntry?: SessionEntry;
  sessionFile?: string;
  config?: OpenClawConfig;
}): Promise<SessionCostSummary | null> {
  const sessionFile =
    params.sessionFile ??
    (params.sessionId ? resolveSessionFilePath(params.sessionId, params.sessionEntry) : undefined);
  if (!sessionFile || !fs.existsSync(sessionFile)) {
    return null;
  }

  const totals = emptyTotals();
  let lastActivity: number | undefined;

  await scanUsageFile({
    filePath: sessionFile,
    config: params.config,
    onEntry: (entry) => {
      applyUsageTotals(totals, entry.usage);
      applyCostTotal(totals, entry.costTotal, entry.isEstimatedCost);
      const ts = entry.timestamp?.getTime();
      if (ts && (!lastActivity || ts > lastActivity)) {
        lastActivity = ts;
      }
    },
  });

  return {
    sessionId: params.sessionId,
    sessionFile,
    lastActivity,
    ...totals,
  };
}
