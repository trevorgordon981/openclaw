import type { NodeRegistry, NodeSession } from "./node-registry.js";

export class NodeHealthMonitor {
  private healthCheckIntervalMs = 30_000; // Every 30s
  private healthCheckTimeoutMs = 5_000; // 5s timeout
  private unhealthyThresholdMs = 60_000; // Mark unhealthy after 60s of failures
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  startMonitoring(nodeRegistry: NodeRegistry): () => void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
    }

    this.intervalHandle = setInterval(() => {
      void this.checkAllNodeHealth(nodeRegistry);
    }, this.healthCheckIntervalMs);

    return () => {
      if (this.intervalHandle) {
        clearInterval(this.intervalHandle);
        this.intervalHandle = null;
      }
    };
  }

  private async checkAllNodeHealth(nodeRegistry: NodeRegistry): Promise<void> {
    const nodes = nodeRegistry.listConnected();

    for (const node of nodes) {
      try {
        const result = await nodeRegistry.invoke({
          nodeId: node.nodeId,
          command: "health.ping",
          timeoutMs: this.healthCheckTimeoutMs,
        });

        if (!result.ok) {
          (node as NodeSession & { lastHealthCheckFailedAt?: number }).lastHealthCheckFailedAt =
            Date.now();
          const failureStart =
            (node as NodeSession & { lastHealthCheckFailedAt?: number }).lastHealthCheckFailedAt ||
            Date.now();
          const failureDuration = Date.now() - failureStart;

          if (failureDuration > this.unhealthyThresholdMs) {
            // Mark as unhealthy and disconnect
            console.warn(`Node ${node.nodeId} unhealthy for ${failureDuration}ms, disconnecting`);
            nodeRegistry.unregister(node.connId);
          }
        } else {
          (node as NodeSession & { lastHealthCheckFailedAt?: number }).lastHealthCheckFailedAt =
            undefined;
          (node as NodeSession & { lastHealthCheckAt?: number }).lastHealthCheckAt = Date.now();
        }
      } catch (err) {
        (node as NodeSession & { lastHealthCheckFailedAt?: number }).lastHealthCheckFailedAt =
          Date.now();
      }
    }
  }
}
