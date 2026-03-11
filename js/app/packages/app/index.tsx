import './index.css';
import '@fontsource-variable/inter';
// SolidDevtools retains disposed memos, causes memory leak
// import 'solid-devtools';

import * as analytics from '@coparse/analytics';
import { initializeLexical } from '@core/component/LexicalMarkdown/init';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { getPlatform, isTauri } from '@core/util/platform';
import { platformFetch } from '@core/util/platformFetch';
import { ErrorBoundary, render } from 'solid-js/web';
import { FatalError } from './component/FatalError';
import { Root } from './component/Root';

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

const renderApp = () => {
  const root = document.getElementById('root');
  if (!root) return console.error('Root element not found');
  document.documentElement.dataset.platform = getPlatform();
  document.documentElement.dataset.touchDevice = isTouchDevice()
    ? 'true'
    : 'false';

  // Used for :focus-visible, which focus-bracket utility uses, to prevent input elements triggering :focus-visible on mouse click
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

function main() {
  console.log('App Version ', import.meta.env.__APP_VERSION__);

  // during `vite dev` (but not dev builds), don't inject analytics/observability
  if (!import.meta.hot) {
    const scheduleIdleTask =
      window.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 1));

    // Lazy load and init observability (Datadog) to reduce initial bundle
    scheduleIdleTask(() => {
      import('@observability').then((Observability) => {
        Observability.init(import.meta.env.__APP_VERSION__);
      });
    });

    // Defer analytics initialization to avoid blocking initial render
    scheduleIdleTask(() => {
      analytics.init({
        appVersion: import.meta.env.__APP_VERSION__,
        segmentWriteKey: import.meta.env.VITE_SEGMENT_WRITE_KEY,
        mode: import.meta.env.MODE,
      });
    });

    // this event is emitted when dynamically loading a module fails
    // for example when you're using the app and a new version is deployed
    window.addEventListener('vite:preloadError', () =>
      window.alert('Please refresh page to update app to new version')
    );
  }

  renderApp();
}

main();
