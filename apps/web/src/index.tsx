import { initializeBrowserObservability } from './observability/browser';
import './index.css';

import '@fontsource-variable/inter';
import '@fontsource-variable/roboto-mono';
import '@fontsource-variable/playfair-display';
// SolidDevtools retains disposed memos, causes memory leak
// import 'solid-devtools';
import { initializeLexical } from '@core/component/LexicalMarkdown/init';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { getPlatform, isTauri } from '@core/util/platform';
import { platformFetch } from '@core/util/platformFetch';
import { promptReloadForFailedLoad } from '@core/util/reloadForNewerBuild';
import { initMonochromeIcons } from '@ui/utils/monochromeIcons';
import { ErrorBoundary, render } from 'solid-js/web';
import { FatalError } from './components/app/FatalError';
import { registerServiceWorker } from './lib/service-worker/register';
import { Root } from './routes/Root';

// Keep bundled assets and the local dev server in the webview's fetch path.
if (isTauri()) {
  window.fetch = platformFetch;
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

async function main() {
  await initializeBrowserObservability();

  console.log('App Version ', import.meta.env.__APP_VERSION__);

  // during `vite dev` (but not dev builds), don't inject analytics/observability
  if (!import.meta.hot) {
    // this event is emitted when dynamically loading a module fails
    // for example when you're using the app and a new version is deployed
    // The rail's update button offers the reload (a toast on touch layouts).
    window.addEventListener('vite:preloadError', () => {
      promptReloadForFailedLoad();
    });
  }

  renderApp();
  registerServiceWorker();
}

// unawaited
main();
