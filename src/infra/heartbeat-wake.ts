export type HeartbeatRunResult =
  | { status: "ran"; durationMs: number }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string };

export type HeartbeatWakeHandler = (opts: { reason?: string }) => Promise<HeartbeatRunResult>;

let handler: HeartbeatWakeHandler | null = null;
let pendingReason: string | null = null;
let scheduled = false;
let running = false;
let timer: NodeJS.Timeout | null = null;

const DEFAULT_COALESCE_MS = 250;
const DEFAULT_RETRY_MS = 1_000;

/**
 * Returns true if a reason is high-priority (cron or exec events).
 * These should not be overwritten by lower-priority reasons (e.g., "interval").
 */
function isPriorityReason(reason: string | null): boolean {
  if (!reason) return false;
  return reason.startsWith("cron:") || reason === "exec-event";
}

function schedule(coalesceMs: number) {
  if (timer) {
    return;
  }
  timer = setTimeout(async () => {
    timer = null;
    scheduled = false;
    const active = handler;
    if (!active) {
      return;
    }
    if (running) {
      scheduled = true;
      schedule(coalesceMs);
      return;
    }

    const reason = pendingReason;
    pendingReason = null;
    running = true;
    try {
      const res = await active({ reason: reason ?? undefined });
      if (res.status === "skipped" && res.reason === "requests-in-flight") {
        // The main lane is busy; retry soon.
        pendingReason = reason ?? "retry";
        schedule(DEFAULT_RETRY_MS);
      }
    } catch {
      // Error is already logged by the heartbeat runner; schedule a retry.
      pendingReason = reason ?? "retry";
      schedule(DEFAULT_RETRY_MS);
    } finally {
      running = false;
      if (pendingReason || scheduled) {
        schedule(coalesceMs);
      }
    }
  }, coalesceMs);
  timer.unref?.();
}

export function setHeartbeatWakeHandler(next: HeartbeatWakeHandler | null) {
  handler = next;
  if (handler && pendingReason) {
    schedule(DEFAULT_COALESCE_MS);
  }
}

export function requestHeartbeatNow(opts?: { reason?: string; coalesceMs?: number }) {
  const incoming = opts?.reason ?? "requested";
  
  // Don't overwrite a high-priority reason (cron/exec-event) with a lower-priority one.
  // This prevents interval heartbeats from canceling pending cron jobs during the coalesce window.
  if (isPriorityReason(pendingReason) && !isPriorityReason(incoming)) {
    // Keep existing high-priority reason, just reschedule
  } else {
    pendingReason = incoming;
  }
  
  schedule(opts?.coalesceMs ?? DEFAULT_COALESCE_MS);
}

export function hasHeartbeatWakeHandler() {
  return handler !== null;
}

export function hasPendingHeartbeatWake() {
  return pendingReason !== null || Boolean(timer) || scheduled;
}
