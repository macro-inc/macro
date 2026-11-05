import { initializeBrowserObservability } from './observability/browser';
import './index.css';

import '@fontsource-variable/inter';
import '@fontsource-variable/roboto-mono';
import '@fontsource-variable/playfair-display';
// SolidDevtools retains disposed memos, causes memory leak
// import 'solid-devtools';
import { initializeLexical } from '@core/component/LexicalMarkdown/init';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { getPlatform } from '@core/util/platform';
import { installPlatformFetch } from '@core/util/platformFetch';
import { recoverFromFailedLoad } from '@core/util/reloadForNewerBuild';
import { Telemetry } from '@macro-inc/observability';
import { initMonochromeIcons } from '@ui/utils/monochromeIcons';
import { ErrorBoundary, render } from 'solid-js/web';
import { FatalError } from './components/app/FatalError';
import { interfaceLanguageReady } from './lib/i18n';
import { prepareNotificationLaunch } from './lib/tauri/notification-launch';
import { perfMark } from './observability/perf-marks';
import { Root } from './routes/Root';

perfMark('boot.entry-evaluated');

installPlatformFetch();

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

async function observabilityReady() {
  await initializeBrowserObservability();
  perfMark('boot.observability-ready');
}

async function languageReady() {
  await interfaceLanguageReady(1000);
  perfMark('boot.language-ready');
}

async function main() {
  perfMark('boot.main');
  // A translated interface waits for its messages (already loading, cached
  // after the first visit) so the first screen isn't English for a moment.
  await Promise.all([observabilityReady(), languageReady()]);
  try {
    await prepareNotificationLaunch();
  } catch (error) {
    Telemetry.error(error, { surface: 'notification-launch' });
  }

  console.log('App Version ', import.meta.env.__APP_VERSION__);

  // during `vite dev` (but not dev builds), don't inject analytics/observability
  if (!import.meta.hot) {
    // this event is emitted when dynamically loading a module or its CSS
    // fails, for example when you're using the app and a new version is
    // deployed. Reloads once, or offers the reload on the rail's update button
    // (a toast on touch layouts).
    window.addEventListener('vite:preloadError', () => {
      recoverFromFailedLoad();
    });
  }

  perfMark('boot.render-start');
  renderApp();
  perfMark('boot.render-returned');
}

main().catch((error) => Telemetry.error(error, { surface: 'app-startup' }));
