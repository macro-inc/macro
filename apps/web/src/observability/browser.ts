import { DEVELOPMENT_PROXY_PREFIX } from '@core/constant/developmentProxy';
import { fireAndForget } from '@core/util/fireAndForget';
import { isIgnorableError } from '@core/util/ignorableErrors';
import { getPlatform, isTauri } from '@core/util/platform';
import { recordBrowserTursoCacheNavigation } from '@graphql-cache/rollout-observability';
import { Telemetry, type TelemetryInitConfig } from '@macro-inc/observability';
import {
  createWebTracingProvider,
  StackContextManager,
} from '@macro-inc/observability/web';
import { startBootTrace } from './boot';
import {
  createDesktopMemoryRecording,
  type DesktopSnapshot,
  desktopResourceAttributes,
  readDesktopDiagnostics,
} from './desktop';
import { startDocumentLifecycle } from './document-lifecycle';
import { frontendInstanceId } from './frontend-instance';
import { configureNativeCallTracing } from './native-call-tracing';
import { startNativeDiagnostics } from './native-diagnostics';
import { recordNativeWebviewStart } from './native-lifecycle';
import { osType } from './os-type';
import { startRuntimeResourceSampling } from './runtime-resources';
import { startTypingBurstTelemetry } from './typing-burst';
import { initializeUiOperationTelemetry } from './ui-operation';

/** Share of production sessions that export perf-class traces. */
const PROD_PERF_SAMPLE_RATE = 0.05;

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

/**
 * A local stack's analytics proxy forwards to the collector; the standalone
 * dev server against hosted dev reaches it through its own proxy.
 */
function localDevelopmentTracesUrl(): string {
  const standalone =
    import.meta.env.VITE_DEV_PROXY === true ||
    import.meta.env.VITE_DEV_PROXY === 'true';
  return standalone
    ? `${DEVELOPMENT_PROXY_PREFIX}/otlp/v1/traces`
    : 'http://localhost:8098/i/otlp/v1/traces';
}

/** Initialize browser telemetry and its application-level lifecycle hooks. */
export async function initializeBrowserObservability(
  onProviderReady?: () => void
): Promise<void> {
  const lifecycle = isTauri() ? startDocumentLifecycle() : undefined;
  import.meta.hot?.dispose(() => lifecycle?.dispose());
  let browserEnabled = false;
  const native = isTauri();
  const desktopReady = native
    ? Promise.resolve().then(() => readDesktopDiagnostics())
    : Promise.resolve(undefined);
  let desktop: DesktopSnapshot | undefined;
  let recording: ReturnType<typeof createDesktopMemoryRecording> | undefined;
  let disposed = false;
  import.meta.hot?.dispose(() => {
    disposed = true;
  });
  const configuredTracesUrl =
    import.meta.env.VITE_OTEL_EXPORTER_URL ??
    (import.meta.hot ? localDevelopmentTracesUrl() : undefined);
  // Local stacks use a same-origin path; exporters expect an absolute URL.
  const fallbackTracesUrl = configuredTracesUrl
    ? new URL(configuredTracesUrl, window.location.origin).href
    : undefined;
  const startup = desktopReady.then((snapshot) => {
    desktop = snapshot;
    recording = snapshot?.identity.recordingId
      ? createDesktopMemoryRecording(snapshot)
      : undefined;
    if (!disposed) {
      const dispose = startNativeDiagnostics(snapshot);
      import.meta.hot?.dispose(dispose);
    }
    const destination = snapshot?.identity.tracesUrl ?? fallbackTracesUrl;
    const tracesUrl = destination
      ? new URL(destination, window.location.origin).href
      : undefined;
    return {
      recording: Boolean(recording),
      tracesUrl,
      logsUrl: tracesUrl?.replace(/\/v1\/traces\/?$/, '/v1/logs'),
    };
  });
  const environment =
    import.meta.env.VITE_OTEL_ENV ??
    (import.meta.env.MODE === 'production' ? 'prod' : 'dev');
  let enablement: Promise<boolean> | undefined;
  async function resolveEnablement(): Promise<boolean> {
    const settings = await startup;
    browserEnabled = settings.recording
      ? true
      : await browserTelemetryEnabled(Boolean(settings.tracesUrl));
    return browserEnabled;
  }
  const telemetryConfig: TelemetryInitConfig = {
    serviceName: 'web-app',
    environment,
    perfSampleRate: environment === 'prod' ? PROD_PERF_SAMPLE_RATE : 1,
    tracesUrl: fallbackTracesUrl,
    logsUrl: fallbackTracesUrl?.replace(/\/v1\/traces\/?$/, '/v1/logs'),
    startup: native ? startup : undefined,
    contextManager: new StackContextManager(),
    resourceAttributes: {
      'service.version': import.meta.env.__APP_VERSION__,
      frontend_instance_id: frontendInstanceId,
      'app.runtime': isTauri() ? 'tauri' : 'browser',
      'app.platform': getPlatform(),
      'os.type': osType(),
      ...(native && desktopResourceAttributes(desktopReady)),
    },
    spanAttributes: () => ({
      ...recording?.attributes(),
      frontend_instance_id: frontendInstanceId,
      native_instance_id: desktop?.identity.instanceId,
    }),
    enabled: () => (enablement ??= resolveEnablement()),
  };

  const initialization = Telemetry.init({
    ...telemetryConfig,
    tracingProvider: (resource, getUserId, perfSampled) =>
      createWebTracingProvider(
        telemetryConfig,
        resource,
        getUserId,
        perfSampled
      ),
  });
  // Capture early UI operations locally while the exporter awaits enablement.
  const disposeUiTelemetry = initializeUiOperationTelemetry();
  import.meta.hot?.dispose(disposeUiTelemetry);
  startBootTrace();
  onProviderReady?.();
  await initialization;
  const { tracesUrl } = await startup;
  if (disposed) return;
  await configureNativeCallTracing({
    enabled: browserEnabled,
    tracesUrl,
    environment: telemetryConfig.environment,
  }).catch(() => Telemetry.warn('Native call tracing configuration failed'));
  if (isTauri()) recordNativeWebviewStart(desktop, lifecycle?.attributes);
  const memoryRecording = recording;
  if (memoryRecording && desktop) {
    memoryRecording.accept(desktop);
    Telemetry.info('Desktop memory recording enabled', {
      'macro.recording.id': desktop.identity.recordingId ?? undefined,
      'service.instance.id': desktop.identity.instanceId,
    });
    fireAndForget(memoryRecording.start(), 'desktop-memory-recording');
    import.meta.hot?.dispose(() => memoryRecording.dispose());
  }
  if (browserEnabled) {
    const disposeTyping = startTypingBurstTelemetry();
    import.meta.hot?.dispose(disposeTyping);
    const disposeResources = startRuntimeResourceSampling(
      recording?.attributes
    );
    import.meta.hot?.dispose(disposeResources);
  }
  recordBrowserTursoCacheNavigation();

  window.addEventListener('pagehide', () =>
    fireAndForget(Telemetry.flush(), 'telemetry-flush')
  );
  window.addEventListener('error', (event) => {
    if (isIgnorableError({ message: event.message, source: event.filename })) {
      return;
    }
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
