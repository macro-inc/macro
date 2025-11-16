import './index.css';
// SolidDevtools retains disposed memos, causes memory leak
// import 'solid-devtools';

import * as analytics from '@coparse/analytics';
import { initializeLexical } from '@core/component/LexicalMarkdown/init';
import * as Observability from '@observability';
import { ErrorBoundary, render } from 'solid-js/web';
import { FatalError } from './component/FatalError';
import { ReactiveFavicon } from './component/ReactiveFavicon';
import { Root } from './component/Root';
import { getCustomCursorEnabled } from './util/cursor';

initializeLexical();

let cursorStyleEl: HTMLStyleElement | null = null;

function updateCursor() {
  if (!document.body || !document.head) return;

  const enabled = getCustomCursorEnabled();
  if (!enabled) {
    if (cursorStyleEl) {
      cursorStyleEl.textContent = '';
    }
    return;
  }

  const accentColor = getComputedStyle(document.documentElement)
    .getPropertyValue('--color-accent')
    .trim();
  if (!accentColor) return;

  // Convert CSS color (oklch/rgb/etc) to hex using canvas
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.fillStyle = accentColor;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  const hexColor =
    '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');

  // Use the default cursor SVG with accent color for white fill
  const svgContent = `<svg width="11.379" height="18.066" viewBox="0 0 11.379 18.066" xmlns="http://www.w3.org/2000/svg"><path id="outline" d="M 6.137,18.066 8,17.063 9.615,16.224 7.047,11.408 h 4.332 L 0,0 v 16.015 l 3.316,-3.221 z" fill="${hexColor}" fill-rule="evenodd"/><path d="m6.42 16.593 1.765-0.941-2.775-5.202h3.604l-8.025-8.043v11.188l2.53-2.442z" fill-rule="evenodd"/></svg>`;
  const encodedSvg = encodeURIComponent(svgContent);
  // Hot spot is at the tip of the cursor pointer, approximately (6, 0) at the top
  const svgCursor = `url('data:image/svg+xml;utf8,${encodedSvg}') 0 2, auto`;

  if (!cursorStyleEl) {
    cursorStyleEl = document.createElement('style');
    cursorStyleEl.id = 'custom-cursor-style';
    document.head.appendChild(cursorStyleEl);
  }

  cursorStyleEl.textContent = `* { cursor: ${svgCursor} !important; }`;
}

// Initialize cursor
function initCursor() {
  if (!document.body || !document.head) {
    requestAnimationFrame(initCursor);
    return;
  }
  setTimeout(updateCursor, 0);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initCursor);
} else {
  initCursor();
}

// Watch for theme changes and preference changes
let lastAccentColor = '';
let lastCursorEnabled = getCustomCursorEnabled();
setInterval(() => {
  if (!document.body) return;
  const currentAccentColor = getComputedStyle(document.documentElement)
    .getPropertyValue('--color-accent')
    .trim();
  const currentCursorEnabled = getCustomCursorEnabled();

  if (
    (currentAccentColor && currentAccentColor !== lastAccentColor) ||
    currentCursorEnabled !== lastCursorEnabled
  ) {
    lastAccentColor = currentAccentColor;
    lastCursorEnabled = currentCursorEnabled;
    updateCursor();
  }
}, 100);

// Listen for immediate preference changes
window.addEventListener('cursor-preference-changed', () => {
  lastCursorEnabled = getCustomCursorEnabled();
  updateCursor();
});

const renderApp = () => {
  const root = document.getElementById('root');
  if (!root) return console.error('Root element not found');

  // Used for :focus-visible, which focus-bracket utility uses, to prevent input elements triggering :focus-visible on mouse click
  document.addEventListener('keydown', () => {
    document.documentElement.dataset.modality = 'keyboard';
  });
  document.addEventListener('mousedown', () => {
    document.documentElement.dataset.modality = 'mouse';
  });

  if (import.meta.env.MODE === 'development') {
    return render(
      () => (
        <ErrorBoundary
          fallback={(error, reset) => (
            <FatalError error={error} reset={reset} />
          )}
        >
          <Root />
          <ReactiveFavicon />
        </ErrorBoundary>
      ),
      root
    );
  }

  render(() => <Root />, root);
};

function main() {
  console.log('App Version ', import.meta.env.__APP_VERSION__);
  Observability.init(import.meta.env.__APP_VERSION__);

  // during `vite dev` (but not dev builds), don't inject analytics garbage
  if (!import.meta.hot) {
    analytics.init({
      appVersion: import.meta.env.__APP_VERSION__,
      segmentWriteKey: import.meta.env.VITE_SEGMENT_WRITE_KEY,
      mode: import.meta.env.MODE,
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
