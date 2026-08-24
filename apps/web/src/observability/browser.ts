import { recordBrowserTursoCacheNavigation } from '@graphql-cache/rollout-observability';
import { Telemetry } from '@macro-inc/observability';
import { createWebTracingProvider } from '@macro-inc/observability/web';
// This static import loads the zone.js Promise patch before application modules run.
import { ZoneContextManager } from '@macro-inc/observability/zone';

async function browserTelemetryEnabled(hasExporter: boolean): Promise<boolean> {
  const override = import.meta.env.VITE_ENABLE_BROWSER_OTEL;

  if (override === 'false') return false;
  if (override === 'true') return true;

  if (import.meta.hot) return hasExporter;

  if (!import.meta.env.VITE_POSTHOG_API_KEY) return false;

  const { analytics } = await import('@app/lib/analytics');
  const flag = 'enable-browser-otel';
  const current = analytics.posthog.isFeatureEnabled(flag);
  if (current !== undefined) return current;

  return new Promise((resolve) => {
    let unsubscribe: (() => void) | undefined;
    let settled = false;
    const timeout = window.setTimeout(() => finish(false), 3_000);

    const finish = (enabled: boolean) => {
      settled = true;
      window.clearTimeout(timeout);
      unsubscribe?.();
      resolve(enabled);
    };

    unsubscribe = analytics.posthog.onFeatureFlags((_flags, _variants, ctx) => {
      finish(
        !ctx?.errorsLoading &&
          (analytics.posthog.isFeatureEnabled(flag) ?? false)
      );
    });

    if (settled) unsubscribe();
  });
}

/** Initialize browser telemetry and its application-level lifecycle hooks. */
export async function initializeBrowserObservability(): Promise<void> {
  const tracesUrl =
    import.meta.env.VITE_OTEL_EXPORTER_URL ??
    (import.meta.hot ? 'http://localhost:8098/i/otlp/v1/traces' : undefined);
  const telemetryConfig = {
    serviceName: 'web-app',
    environment:
      import.meta.env.VITE_OTEL_ENV ??
      (import.meta.env.MODE === 'production' ? 'prod' : 'dev'),
    tracesUrl,
    logsUrl: tracesUrl?.replace(/\/v1\/traces\/?$/, '/v1/logs'),
    contextManager: new ZoneContextManager(),
    enabled: () => browserTelemetryEnabled(Boolean(tracesUrl)),
  };

  await Telemetry.init({
    ...telemetryConfig,
    tracingProvider: (resource, getUserId) =>
      createWebTracingProvider(telemetryConfig, resource, getUserId),
  });
  recordBrowserTursoCacheNavigation();

  window.addEventListener('pagehide', () => void Telemetry.flush());
  window.addEventListener('error', (event) => {
    Telemetry.error(event.error ?? event.message, {
      'error.source': 'window',
    });
  });
  window.addEventListener('unhandledrejection', (event) => {
    Telemetry.error(event.reason, {
      'error.source': 'unhandledrejection',
    });
  });
}
