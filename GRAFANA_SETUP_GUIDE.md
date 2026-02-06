# Grafana Setup Guide for OpenClaw Optimization Metrics

This guide walks through setting up Grafana to monitor OpenClaw token savings, performance, and cost metrics.

## Architecture

```
OpenClaw (src/infra/prometheus-exporter.ts)
    ↓ (Prometheus format @ :9090/metrics)
    ↓
Prometheus (scrapes every 15s)
    ↓
Grafana (queries Prometheus)
    ↓
Dashboards: Token Savings, Cache Performance, Cost Tracking
```

## Prerequisites

- Docker or local Prometheus/Grafana installation
- OpenClaw running with prometheus-exporter initialized
- Git repo checked out at `/home/ubuntu/openclaw`

## Quick Start (Docker Compose)

### 1. Create docker-compose.yml

```yaml
version: "3.8"
services:
  prometheus:
    image: prom/prometheus:latest
    ports:
      - "9091:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus-storage:/prometheus
    command:
      - "--config.file=/etc/prometheus/prometheus.yml"
      - "--storage.tsdb.path=/prometheus"

  grafana:
    image: grafana/grafana:latest
    ports:
      - "3000:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
    volumes:
      - grafana-storage:/var/lib/grafana
      - ./grafana/provisioning:/etc/grafana/provisioning

volumes:
  prometheus-storage:
  grafana-storage:
```

### 2. Create prometheus.yml

```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: "openclaw"
    static_configs:
      - targets: ["host.docker.internal:9090"]  # Or your OpenClaw metrics server IP
```

### 3. Start Services

```bash
docker-compose up -d
```

Grafana will be at http://localhost:3000 (default admin/admin)

## Provisioning Dashboards

### Option A: Automated (Recommended)

Copy the dashboard JSON and provision via Grafana:

```bash
mkdir -p grafana/provisioning/dashboards
cp grafana/openclaw-optimization-dashboard.json grafana/provisioning/dashboards/

# Create dashboard provisioning config
cat > grafana/provisioning/dashboards/dashboards.yml << 'EOF'
apiVersion: 1

providers:
  - name: 'OpenClaw'
    orgId: 1
    folder: ''
    type: file
    disableDeletion: false
    updateIntervalSeconds: 10
    allowUiUpdates: true
    options:
      path: /etc/grafana/provisioning/dashboards
EOF
```

### Option B: Manual Import

1. Log in to Grafana (http://localhost:3000)
2. Left sidebar → Dashboards → Import
3. Upload `grafana/openclaw-optimization-dashboard.json`
4. Select Prometheus data source
5. Click Import

## Data Source Configuration

### Add Prometheus Data Source

1. **Settings** (gear icon) → **Data Sources**
2. **Add data source** → Select **Prometheus**
3. **URL:** `http://prometheus:9090` (in Docker) or `http://localhost:9091` (local)
4. **HTTP Method:** GET
5. Click **Save & test**

You should see: ✅ "Prometheus is ready to be saved and used."

## Available Metrics

All metrics are automatically exported by the prometheus-exporter module:

### Token Savings
- `openclaw_token_savings_total` — Total tokens saved (counter)
- `openclaw_token_savings_rate` — Savings rate as % (gauge)
- `openclaw_token_savings_phase_1` — Phase 1 savings (counter)
- `openclaw_token_savings_phase_2` — Phase 2 savings (counter)
- `openclaw_token_savings_phase_3` — Phase 3 savings (counter)

### Cache Performance
- `openclaw_tool_cache_hits_total` — Tool cache hits (counter)
- `openclaw_tool_cache_misses_total` — Tool cache misses (counter)
- `openclaw_http_cache_hits_total` — HTTP cache hits (counter)
- `openclaw_http_cache_misses_total` — HTTP cache misses (counter)

### Message Compression
- `openclaw_message_compression_ratio` — Compression ratio (gauge)
- `openclaw_bytes_compressed_total` — Total bytes compressed (counter)

### Performance Latency
- `openclaw_tool_invocation_duration_seconds` — Tool latency (histogram)
- `openclaw_memory_search_duration_seconds` — Memory search latency (histogram)
- `openclaw_api_call_duration_seconds` — API call latency (histogram)

### Cost Metrics
- `openclaw_cost_savings_total` — Cost savings in USD (counter)
- `openclaw_cost_per_session` — Cost per session in USD (gauge)
- `openclaw_cost_per_token` — Cost per token in µ-cents (gauge)

### Integration Health
- `openclaw_aws_integration_status` — AWS health (0=down, 1=up)
- `openclaw_slack_integration_status` — Slack health (0=down, 1=up)

## Dashboard Panels Explained

### 1. Token Savings (Phase 1-3)
Large stat panel showing total tokens saved. Color-coded:
- Green: >8% savings
- Yellow: 5-8% savings
- Red: <5% savings

### 2. Token Savings Rate (%)
Gauge showing real-time savings rate. Target: 8-11% (Phase 1-3 combined).

### 3. Tool Result Cache Hit Rate
Gauge showing % of tool calls served from cache. Target: 60%+

### 4. HTTP Response Cache Hit Rate
Gauge showing % of API calls served from cache. Target: 70%+

### 5. Message Compression Ratio
Stat showing average compression ratio. Formula: `compressed_size / original_size`

### 6. Cost Savings (Daily)
Time series showing daily cost savings in USD. 
- Formula: `increase(openclaw_cost_savings_total[1d])`
- Example: $40-60/day for 1000 sessions

### 7. Tool Invocation Latency (p99)
Time series of 99th percentile tool latency. Should be stable or decreasing with caching.

### 8. AWS Integration Health
Stat showing AWS service status (Healthy = 1, Unhealthy = 0).
Alert if drops below 1.

### 9. Slack Integration Health
Stat showing Slack connection status (Healthy = 1, Unhealthy = 0).
Alert if drops below 1.

### 10. Tokens Saved by Phase
Pie chart breaking down savings by Phase 1, Phase 2, Phase 3.

### 11. Memory Search Performance
Time series of p95 memory search latency. Should decrease with semantic indexing.

### 12. Cost per Session (Trend)
Time series showing cost per session over time. Should trend downward.

## Alerts (Optional)

### Alert Rules

Create `prometheus/alerts.yml`:

```yaml
groups:
  - name: openclaw_optimization
    rules:
      # Token Savings Alert
      - alert: LowTokenSavingsRate
        expr: openclaw_token_savings_rate < 5
        for: 1h
        labels:
          severity: warning
        annotations:
          summary: "Token savings rate below 5%"
          description: "Current rate: {{ $value }}%"

      # AWS Integration Down
      - alert: AWSIntegrationDown
        expr: openclaw_aws_integration_status == 0
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "AWS integration is down"

      # Slack Integration Down
      - alert: SlackIntegrationDown
        expr: openclaw_slack_integration_status == 0
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Slack integration is down"

      # Cache Hit Rate Low
      - alert: LowCacheHitRate
        expr: |
          (rate(openclaw_tool_cache_hits_total[5m]) / 
           (rate(openclaw_tool_cache_hits_total[5m]) + rate(openclaw_tool_cache_misses_total[5m]))) < 0.3
        for: 30m
        labels:
          severity: warning
        annotations:
          summary: "Tool cache hit rate below 30%"
```

Add to `prometheus.yml`:

```yaml
alerting:
  alertmanagers:
    - static_configs:
        - targets: []

rule_files:
  - "alerts.yml"
```

## Verification

### Check Metrics Endpoint

```bash
curl http://localhost:9090/metrics
```

Should return Prometheus format metrics like:

```
# HELP openclaw_token_savings_total Total tokens saved across all phases
# TYPE openclaw_token_savings_total counter
openclaw_token_savings_total 156000 1707189000000
```

### Verify Prometheus Scrape

1. Go to http://localhost:9091 (Prometheus)
2. **Status** → **Targets**
3. Look for job_name: "openclaw" with state: "UP"

### Verify Grafana Dashboard

1. Go to http://localhost:3000 (Grafana)
2. Home → Dashboards → Search "OpenClaw"
3. Open "OpenClaw Token & Performance Optimization"
4. All panels should show data (no "No Data" warnings)

## Integration with OpenClaw

### Initialize Exporter in pi-tools.ts

```typescript
import { initPrometheusExporter, recordPerformanceMetrics } from "../infra/prometheus-exporter.js";

// In initialization
initPrometheusExporter(9090);

// In tool execution loop
recordPerformanceMetrics(performanceMetrics);
```

### Hook Performance Metrics into Tool Results Cache

```typescript
import { recordMetric } from "../infra/prometheus-exporter.js";

// In tool-result-cache.ts
if (cached) {
  recordMetric("openclaw_tool_cache_hits_total", 1);
} else {
  recordMetric("openclaw_tool_cache_misses_total", 1);
}
```

### Hook Cost Metrics

```typescript
// In cost-metrics.ts or session-cost-usage.ts
import { recordMetric } from "../infra/prometheus-exporter.js";

recordMetric("openclaw_cost_savings_total", costSavings);
recordMetric("openclaw_cost_per_session", costPerSession);
```

## Troubleshooting

### No Data in Dashboard

1. Check Prometheus targets: http://localhost:9091/targets
2. Verify OpenClaw metrics endpoint: `curl http://localhost:9090/metrics`
3. Check Grafana logs: `docker logs openclaw_grafana_1`
4. Verify data source URL in Grafana settings

### Metrics Not Updating

1. Check if prometheus-exporter is initialized: `curl http://localhost:9090/health`
2. Verify prometheus scrape interval: Check `prometheus.yml` (default: 15s)
3. Check OpenClaw logs for errors

### Integration Alerts Firing

1. **AWS Down:** Check AWS credentials in OpenClaw config
2. **Slack Down:** Check Slack bot token and permissions
3. Both: Review `/home/ubuntu/openclaw/src/channels/plugins/` for auth issues

## Next Steps

1. **Real-time Alerting:** Connect Slack/PagerDuty webhook to Prometheus AlertManager
2. **Custom Dashboards:** Create additional dashboards for:
   - Per-model cost breakdown
   - Semantic memory retrieval performance
   - Workflow execution success rates
3. **SLA Tracking:** Set dashboard refresh to 30s for production monitoring
4. **Capacity Planning:** Use cost trends to forecast monthly spend

## References

- [Prometheus Documentation](https://prometheus.io/docs)
- [Grafana Dashboard Docs](https://grafana.com/docs/grafana/latest/dashboards/)
- [OpenClaw Performance Metrics](./src/infra/performance-metrics.ts)
