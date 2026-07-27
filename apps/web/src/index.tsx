import './index.css';
// hands @macro-inc/observability its config before anything emits, and lands
// the zone.js Promise patch (via the library's zone entry) before app code
// captures unpatched Promise references.
import { Telemetry } from '@macro-inc/observability';
import { createWebTracingProvider } from '@macro-inc/observability/web';
import { ZoneContextManager } from '@macro-inc/observability/zone';

import '@fontsource-variable/inter';
import '@fontsource-variable/roboto-mono';
import '@fontsource-variable/playfair-display';
// SolidDevtools retains disposed memos, causes memory leak
// import 'solid-devtools';
import { initializeLexical } from '@core/component/LexicalMarkdown/init';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { getPlatform, isTauri } from '@core/util/platform';
import { platformFetch } from '@core/util/platformFetch';
import { initMonochromeIcons } from '@ui/utils/monochromeIcons';
import { ErrorBoundary, render } from 'solid-js/web';
import { FatalError } from './components/app/FatalError';
import { Root } from './routes/Root';

// Override global fetch with platformFetch for Tauri compatibility
// Skip localhost requests (dev server) to avoid breaking HMR
if (isTauri()) {
  const originalFetch = window.fetch;
  window.fetch = new Proxy(originalFetch, {
    apply: (target, thisArg, args) => {
      const url = args[0];
      const urlString = url instanceof Request ? url.url : String(url);
      if (urlString.includes('localhost')) {
        return target.apply(thisArg, args as Parameters<typeof fetch>);
      }
      return platformFetch.apply(thisArg, args as Parameters<typeof fetch>);
    },
  });
}

initializeLexical();
initMonochromeIcons();

const renderApp = () => {
  const root = document.getElementById('root');
  if (!root) return console.error('Root element not found');
  document.documentElement.dataset.platform = getPlatform();
  document.documentElement.dataset.touchDevice = isTouchDevice()
    ? 'true'
    : 'false';

  // Track current input modality (keyboard / mouse / touch) on the document element.
  // Used by hotkeys and other modality-aware behaviors.
  // Use capture phase to ensure we catch events even if they're stopped by handlers
  document.addEventListener(
    'keydown',
    () => {
      document.documentElement.dataset.modality = 'keyboard';
    },
    { capture: true }
  );

  document.addEventListener(
    'mousedown',
    () => {
      document.documentElement.dataset.modality = 'mouse';
    },
    { capture: true }
  );

  document.addEventListener(
    'touchstart',
    () => {
      document.documentElement.dataset.modality = 'touch';
    },
    { capture: true, passive: true }
  );

  if (import.meta.env.MODE === 'development') {
    return render(
      () => (
        <ErrorBoundary
          fallback={(error, reset) => (
            <FatalError error={error} reset={reset} />
          )}
        >
          <Root />
        </ErrorBoundary>
      ),
      root
    );
  }

  render(() => <Root />, root);
};

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

async function main() {
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

  console.log('App Version ', import.meta.env.__APP_VERSION__);

  // during `vite dev` (but not dev builds), don't inject analytics/observability
  if (!import.meta.hot) {
    // this event is emitted when dynamically loading a module fails
    // for example when you're using the app and a new version is deployed
    window.addEventListener('vite:preloadError', () =>
      window.alert('Please refresh page to update app to new version')
    );
  }

  renderApp();
}

// unawaited
main();
