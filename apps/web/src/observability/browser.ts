import { getPlatform, isTauri } from '@core/util/platform';
import { recordBrowserTursoCacheNavigation } from '@graphql-cache/rollout-observability';
import { Telemetry } from '@macro-inc/observability';
import { createWebTracingProvider } from '@macro-inc/observability/web';
// This static import loads the zone.js Promise patch before application modules run.
import { ZoneContextManager } from '@macro-inc/observability/zone';
import {
  createDesktopMemoryRecording,
  desktopResourceAttributes,
  readDesktopDiagnostics,
} from './desktop';
import { initializeUiOperationTelemetry } from './ui-operation';

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

const MAX_EARLY_ERRORS = 50;

/**
 * Initialize browser telemetry and its application-level lifecycle hooks.
 * Error listeners attach synchronously; callers need not await the rest.
 */
export async function initializeBrowserObservability(): Promise<void> {
  // The app renders while telemetry initializes, and records emitted before a
  // provider is installed are dropped: hold early errors until init settles.
  let earlyErrors: Parameters<typeof Telemetry.error>[] | undefined = [];
  const reportError = (...report: Parameters<typeof Telemetry.error>) => {
    if (!earlyErrors) Telemetry.error(...report);
    else if (earlyErrors.length < MAX_EARLY_ERRORS) earlyErrors.push(report);
  };
  window.addEventListener('pagehide', () => void Telemetry.flush());
  window.addEventListener('error', (event) => {
    reportError(event.error ?? event.message, { 'error.source': 'window' });
  });
  window.addEventListener('unhandledrejection', (event) => {
    reportError(event.reason, { 'error.source': 'unhandledrejection' });
  });

  try {
    await initializeTelemetry();
  } finally {
    const reports = earlyErrors;
    earlyErrors = undefined;
    for (const report of reports) Telemetry.error(...report);
  }
}

async function initializeTelemetry(): Promise<void> {
  let browserEnabled = false;
  const desktop = await readDesktopDiagnostics();
  const recording = desktop?.identity.recordingId
    ? createDesktopMemoryRecording(desktop)
    : undefined;
  const configuredTracesUrl =
    desktop?.identity.tracesUrl ??
    import.meta.env.VITE_OTEL_EXPORTER_URL ??
    (import.meta.hot ? 'http://localhost:8098/i/otlp/v1/traces' : undefined);
  // Local stacks use a same-origin path; exporters expect an absolute URL.
  const tracesUrl = configuredTracesUrl
    ? new URL(configuredTracesUrl, window.location.origin).href
    : undefined;
  const telemetryConfig = {
    serviceName: 'web-app',
    environment:
      import.meta.env.VITE_OTEL_ENV ??
      (import.meta.env.MODE === 'production' ? 'prod' : 'dev'),
    tracesUrl,
    logsUrl: tracesUrl?.replace(/\/v1\/traces\/?$/, '/v1/logs'),
    contextManager: new ZoneContextManager(),
    resourceAttributes: {
      'service.version': import.meta.env.__APP_VERSION__,
      'app.runtime': isTauri() ? 'tauri' : 'browser',
      'app.platform': getPlatform(),
      ...(desktop && desktopResourceAttributes(desktop)),
    },
    recording: Boolean(recording),
    spanAttributes: recording?.attributes,
    enabled: async () => {
      browserEnabled = recording
        ? true
        : await browserTelemetryEnabled(Boolean(tracesUrl));
      return browserEnabled;
    },
  };

  await Telemetry.init({
    ...telemetryConfig,
    tracingProvider: (resource, getUserId) =>
      createWebTracingProvider(telemetryConfig, resource, getUserId),
  });
  if (recording && desktop) {
    recording.accept(desktop);
    Telemetry.info('Desktop memory recording enabled', {
      'macro.recording.id': desktop.identity.recordingId ?? undefined,
      'service.instance.id': desktop.identity.instanceId,
    });
    void recording.start();
    import.meta.hot?.dispose(() => recording.dispose());
  }
  recordBrowserTursoCacheNavigation();
  if (browserEnabled) {
    const disposeUiTelemetry = initializeUiOperationTelemetry();
    import.meta.hot?.dispose(disposeUiTelemetry);
  }
}
