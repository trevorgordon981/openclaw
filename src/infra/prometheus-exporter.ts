/**
 * Prometheus Metrics Exporter for OpenClaw Optimization
 *
 * Exports all optimization metrics (token savings, cache performance, costs)
 * in Prometheus format for Grafana integration.
 *
 * Usage:
 *   import { initPrometheusExporter, recordMetric } from "./prometheus-exporter";
 *   initPrometheusExporter(9090);
 *   recordMetric("openclaw_token_savings_total", 50000);
 */

import express from "express";
import type { PerformanceMetrics } from "./performance-metrics.js";

interface MetricValue {
  timestamp: number;
  value: number;
  labels?: Record<string, string>;
}

interface MetricRegistry {
  [key: string]: MetricValue[];
}

class PrometheusExporter {
  private app: express.Application;
  private port: number;
  private metrics: MetricRegistry = {};
  private startTime = Date.now();

  constructor(port: number = 9090) {
    this.port = port;
    this.app = express();
    this.setupRoutes();
  }

  private setupRoutes() {
    // Prometheus scrape endpoint
    this.app.get("/metrics", (req, res) => {
      res.set("Content-Type", "text/plain; version=0.0.4");
      res.send(this.generatePrometheusOutput());
    });

    // Health check
    this.app.get("/health", (req, res) => {
      res.json({ status: "healthy", uptime: Date.now() - this.startTime });
    });

    // Metrics API (for debugging)
    this.app.get("/api/metrics", (req, res) => {
      res.json(this.metrics);
    });
  }

  public recordMetric(
    name: string,
    value: number,
    labels?: Record<string, string>
  ) {
    if (!this.metrics[name]) {
      this.metrics[name] = [];
    }

    // Keep last 1000 samples per metric
    this.metrics[name].push({
      timestamp: Date.now(),
      value,
      labels,
    });

    if (this.metrics[name].length > 1000) {
      this.metrics[name].shift();
    }
  }

  public recordPerformanceMetrics(metrics: PerformanceMetrics) {
    // Token savings
    if (metrics.tokensSavedPhase1) {
      this.recordMetric("openclaw_token_savings_phase_1", metrics.tokensSavedPhase1);
    }
    if (metrics.tokensSavedPhase2) {
      this.recordMetric("openclaw_token_savings_phase_2", metrics.tokensSavedPhase2);
    }
    if (metrics.tokensSavedPhase3) {
      this.recordMetric("openclaw_token_savings_phase_3", metrics.tokensSavedPhase3);
    }

    // Total savings
    const totalSavings =
      (metrics.tokensSavedPhase1 || 0) +
      (metrics.tokensSavedPhase2 || 0) +
      (metrics.tokensSavedPhase3 || 0);
    this.recordMetric("openclaw_token_savings_total", totalSavings);

    // Savings rate
    if (metrics.savingsRate) {
      this.recordMetric("openclaw_token_savings_rate", metrics.savingsRate * 100);
    }

    // Cache performance
    if (metrics.cacheMetrics) {
      this.recordMetric(
        "openclaw_tool_cache_hits_total",
        metrics.cacheMetrics.toolCacheHits || 0
      );
      this.recordMetric(
        "openclaw_tool_cache_misses_total",
        metrics.cacheMetrics.toolCacheMisses || 0
      );
      this.recordMetric(
        "openclaw_http_cache_hits_total",
        metrics.cacheMetrics.httpCacheHits || 0
      );
      this.recordMetric(
        "openclaw_http_cache_misses_total",
        metrics.cacheMetrics.httpCacheMisses || 0
      );
    }

    // Message compression
    if (metrics.compressionMetrics) {
      this.recordMetric(
        "openclaw_message_compression_ratio",
        metrics.compressionMetrics.ratio || 0
      );
      this.recordMetric(
        "openclaw_bytes_compressed_total",
        metrics.compressionMetrics.bytesCompressed || 0
      );
    }

    // Latency metrics
    if (metrics.latencyMetrics) {
      this.recordMetric(
        "openclaw_tool_invocation_duration_seconds",
        (metrics.latencyMetrics.toolInvocation || 0) / 1000
      );
      this.recordMetric(
        "openclaw_memory_search_duration_seconds",
        (metrics.latencyMetrics.memorySearch || 0) / 1000
      );
      this.recordMetric(
        "openclaw_api_call_duration_seconds",
        (metrics.latencyMetrics.apiCall || 0) / 1000
      );
    }

    // Cost metrics
    if (metrics.costMetrics) {
      this.recordMetric("openclaw_cost_savings_total", metrics.costMetrics.totalSavings);
      this.recordMetric("openclaw_cost_per_session", metrics.costMetrics.costPerSession);
      this.recordMetric("openclaw_cost_per_token", metrics.costMetrics.costPerToken * 1000000); // Convert to micro-cents for precision
    }

    // Integration health
    if (metrics.integrationHealth) {
      this.recordMetric(
        "openclaw_aws_integration_status",
        metrics.integrationHealth.aws ? 1 : 0
      );
      this.recordMetric(
        "openclaw_slack_integration_status",
        metrics.integrationHealth.slack ? 1 : 0
      );
    }
  }

  private generatePrometheusOutput(): string {
    const lines: string[] = [];

    lines.push("# HELP openclaw_token_savings_total Total tokens saved across all phases");
    lines.push("# TYPE openclaw_token_savings_total counter");
    lines.push(
      `openclaw_token_savings_total ${this.getLatestMetricValue("openclaw_token_savings_total")} ${Date.now()}`
    );

    lines.push(
      "# HELP openclaw_token_savings_rate Token savings rate as percentage"
    );
    lines.push("# TYPE openclaw_token_savings_rate gauge");
    lines.push(
      `openclaw_token_savings_rate ${this.getLatestMetricValue("openclaw_token_savings_rate")} ${Date.now()}`
    );

    lines.push(
      "# HELP openclaw_tool_cache_hits_total Total tool cache hits"
    );
    lines.push("# TYPE openclaw_tool_cache_hits_total counter");
    lines.push(
      `openclaw_tool_cache_hits_total ${this.getLatestMetricValue("openclaw_tool_cache_hits_total")} ${Date.now()}`
    );

    lines.push(
      "# HELP openclaw_tool_cache_misses_total Total tool cache misses"
    );
    lines.push("# TYPE openclaw_tool_cache_misses_total counter");
    lines.push(
      `openclaw_tool_cache_misses_total ${this.getLatestMetricValue("openclaw_tool_cache_misses_total")} ${Date.now()}`
    );

    lines.push(
      "# HELP openclaw_http_cache_hits_total Total HTTP cache hits"
    );
    lines.push("# TYPE openclaw_http_cache_hits_total counter");
    lines.push(
      `openclaw_http_cache_hits_total ${this.getLatestMetricValue("openclaw_http_cache_hits_total")} ${Date.now()}`
    );

    lines.push(
      "# HELP openclaw_http_cache_misses_total Total HTTP cache misses"
    );
    lines.push("# TYPE openclaw_http_cache_misses_total counter");
    lines.push(
      `openclaw_http_cache_misses_total ${this.getLatestMetricValue("openclaw_http_cache_misses_total")} ${Date.now()}`
    );

    lines.push(
      "# HELP openclaw_message_compression_ratio Message compression ratio"
    );
    lines.push("# TYPE openclaw_message_compression_ratio gauge");
    lines.push(
      `openclaw_message_compression_ratio ${this.getLatestMetricValue("openclaw_message_compression_ratio")} ${Date.now()}`
    );

    lines.push(
      "# HELP openclaw_cost_savings_total Total cost savings in USD"
    );
    lines.push("# TYPE openclaw_cost_savings_total counter");
    lines.push(
      `openclaw_cost_savings_total ${this.getLatestMetricValue("openclaw_cost_savings_total")} ${Date.now()}`
    );

    lines.push("# HELP openclaw_cost_per_session Cost per session in USD");
    lines.push("# TYPE openclaw_cost_per_session gauge");
    lines.push(
      `openclaw_cost_per_session ${this.getLatestMetricValue("openclaw_cost_per_session")} ${Date.now()}`
    );

    lines.push(
      "# HELP openclaw_aws_integration_status AWS integration health status"
    );
    lines.push("# TYPE openclaw_aws_integration_status gauge");
    lines.push(
      `openclaw_aws_integration_status ${this.getLatestMetricValue("openclaw_aws_integration_status")} ${Date.now()}`
    );

    lines.push(
      "# HELP openclaw_slack_integration_status Slack integration health status"
    );
    lines.push("# TYPE openclaw_slack_integration_status gauge");
    lines.push(
      `openclaw_slack_integration_status ${this.getLatestMetricValue("openclaw_slack_integration_status")} ${Date.now()}`
    );

    return lines.join("\n");
  }

  private getLatestMetricValue(metricName: string): number {
    const values = this.metrics[metricName];
    if (!values || values.length === 0) return 0;
    return values[values.length - 1].value;
  }

  public start() {
    this.app.listen(this.port, () => {
      console.log(
        `Prometheus exporter listening on http://localhost:${this.port}/metrics`
      );
    });
  }

  public stop() {
    // Implementation for graceful shutdown
  }
}

// Singleton instance
let exporter: PrometheusExporter | null = null;

export function initPrometheusExporter(port: number = 9090): PrometheusExporter {
  if (!exporter) {
    exporter = new PrometheusExporter(port);
    exporter.start();
  }
  return exporter;
}

export function recordMetric(
  name: string,
  value: number,
  labels?: Record<string, string>
) {
  if (!exporter) {
    exporter = initPrometheusExporter();
  }
  exporter.recordMetric(name, value, labels);
}

export function recordPerformanceMetrics(metrics: PerformanceMetrics) {
  if (!exporter) {
    exporter = initPrometheusExporter();
  }
  exporter.recordPerformanceMetrics(metrics);
}

export function getExporter(): PrometheusExporter {
  if (!exporter) {
    exporter = initPrometheusExporter();
  }
  return exporter;
}
