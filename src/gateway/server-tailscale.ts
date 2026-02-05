import {
  disableTailscaleFunnel,
  disableTailscaleServe,
  enableTailscaleFunnel,
  enableTailscaleServe,
  getTailnetHostname,
} from "../infra/tailscale.js";

export async function startGatewayTailscaleExposure(params: {
  tailscaleMode: "off" | "serve" | "funnel";
  resetOnExit?: boolean;
  port: number;
  controlUiBasePath?: string;
  logTailscale: { info: (msg: string) => void; warn: (msg: string) => void };
}): Promise<(() => Promise<void>) | null> {
  if (params.tailscaleMode === "off") {
    return null;
  }

  let retryCount = 0;
  const MAX_RETRIES = 5;
  const INITIAL_BACKOFF_MS = 5000;

  const attemptEnable = async (): Promise<boolean> => {
    try {
      if (params.tailscaleMode === "serve") {
        await enableTailscaleServe(params.port);
      } else {
        await enableTailscaleFunnel(params.port);
      }

      const host = await getTailnetHostname().catch(() => null);
      if (host) {
        const uiPath = params.controlUiBasePath ? `${params.controlUiBasePath}/` : "/";
        params.logTailscale.info(
          `${params.tailscaleMode} enabled: https://${host}${uiPath} (WS via wss://${host})`,
        );
      } else {
        params.logTailscale.info(`${params.tailscaleMode} enabled`);
      }
      return true;
    } catch (err) {
      retryCount++;
      const delay = INITIAL_BACKOFF_MS * Math.pow(2, retryCount - 1);
      params.logTailscale.warn(
        `${params.tailscaleMode} failed (attempt ${retryCount}/${MAX_RETRIES}): ${err instanceof Error ? err.message : String(err)}. Retrying in ${delay}ms...`,
      );

      if (retryCount < MAX_RETRIES) {
        setTimeout(() => void attemptEnable(), delay);
      }
      return false;
    }
  };

  const enabled = await attemptEnable();
  if (!enabled && !params.resetOnExit) {
    return null;
  }

  if (!params.resetOnExit) {
    return null;
  }

  return async () => {
    try {
      if (params.tailscaleMode === "serve") {
        await disableTailscaleServe();
      } else {
        await disableTailscaleFunnel();
      }
    } catch (err) {
      params.logTailscale.warn(
        `${params.tailscaleMode} cleanup failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };
}
