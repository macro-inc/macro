import { invoke } from '@tauri-apps/api/core';

declare global {
  interface Window {
    __MACRO_ANDROID_CALL_TRACING__?: boolean;
  }
}

/** Retain the existing telemetry gate and exporter for native calls without a running WebView. */
export async function configureNativeCallTracing(config: {
  enabled: boolean;
  tracesUrl?: string;
  environment: string;
}): Promise<void> {
  // New web bundles also run on installed binaries that predate this command.
  if (window.__MACRO_ANDROID_CALL_TRACING__ !== true) return;
  await invoke('plugin:call-kit|configure_tracing', {
    tracesUrl: config.enabled ? (config.tracesUrl ?? null) : null,
    environment: config.environment,
  });
}
