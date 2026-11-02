import { initializeBrowserObservability } from './observability/browser';
import './index.css';

import '@fontsource-variable/inter';
import '@fontsource-variable/roboto-mono';
import '@fontsource-variable/playfair-display';
// SolidDevtools retains disposed memos, causes memory leak
// import 'solid-devtools';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { registerChunkLoadRecovery } from '@core/util/chunk-load-errors';
import { fireAndForget } from '@core/util/fireAndForget';
import { getPlatform, isTauri } from '@core/util/platform';
import { initializePlatformFetch } from '@core/util/platformFetch';
import { recoverFromFailedLoad } from '@core/util/reloadForNewerBuild';
import { Telemetry } from '@macro-inc/observability';
import { initMonochromeIcons } from '@ui/utils/monochromeIcons';
import { ErrorBoundary, render } from 'solid-js/web';
import { FatalError } from './components/app/FatalError';
import { interfaceLanguageReady } from './lib/i18n';
import { prepareNotificationLaunch } from './lib/tauri/notification-launch';
import { perfMark } from './observability/perf-marks';
import { loadPlatformStyles } from './platform-styles';
import { Root } from './routes/Root';

perfMark('boot.entry-evaluated');

// Preserve the browser transport for assets and use native cookies for services.
if (isTauri()) {
  const webviewFetch = window.fetch.bind(window);
  window.fetch = initializePlatformFetch(webviewFetch);
}

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

async function observabilityReady(onProviderReady?: () => void) {
  await initializeBrowserObservability(onProviderReady);
  perfMark('boot.observability-ready');
}

async function initializeObservability(ready: () => void) {
  try {
    await observabilityReady(ready);
  } catch (error) {
    // Startup can continue when provider setup itself fails.
    ready();
    Telemetry.error(error, { surface: 'browser-observability' });
  }
}

async function languageReady() {
  await interfaceLanguageReady(1000);
  perfMark('boot.language-ready');
}

async function main() {
  perfMark('boot.main');
  // The dev server handles reload recovery through its HMR client.
  if (!import.meta.hot) {
    // this event is emitted when dynamically loading a module or its CSS
    // fails, for example when you're using the app and a new version is
    // deployed. Reloads once, or offers the reload on the rail's update button
    // (a toast on touch layouts).
    registerChunkLoadRecovery(recoverFromFailedLoad);
  }

  // A translated interface waits for its messages (already loading, cached
  // after the first visit) so the first screen isn't English for a moment.
  const nativeProviderReady = new Promise<void>((resolve) => {
    // Register tracing before render; native diagnostics and remote enablement
    // resolve afterward.
    fireAndForget(initializeObservability(resolve), 'browser-observability');
  });
  await Promise.all([
    languageReady(),
    loadPlatformStyles(),
    ...(isTauri() ? [nativeProviderReady] : []),
  ]);
  try {
    await prepareNotificationLaunch();
  } catch (error) {
    Telemetry.error(error, { surface: 'notification-launch' });
  }

  console.log('App Version ', import.meta.env.__APP_VERSION__);

  perfMark('boot.render-start');
  renderApp();
  perfMark('boot.render-returned');
}

main().catch((error) => Telemetry.error(error, { surface: 'app-startup' }));
