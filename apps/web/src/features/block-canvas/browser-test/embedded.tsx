import '@fontsource-variable/inter';
import '@app/index.css';
import { applyTheme } from '@app/features/theme/utils/themeUtils';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import {
  createGraphicsEditor,
  type GraphicsEditor,
  translation,
} from '@macro-inc/graphics';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { For, onCleanup } from 'solid-js';
import { render } from 'solid-js/web';
import { MobileCanvasEmbeddedView } from '../views/mobile/canvas-embedded-view';
import { createCanvasTextMeasurer } from '../views/text-content';

declare global {
  interface Window {
    canvasEmbeddedFixture: { editor: GraphicsEditor };
  }
}

/**
 * A canvas inside a document, as a phone or tablet shows it: the real touch
 * embed between paragraphs of a page long enough to scroll. No session, sync
 * or services.
 */
function Fixture() {
  const measurement = createCanvasTextMeasurer();
  onCleanup(measurement.dispose);
  const editor = createGraphicsEditor(
    [
      {
        id: 'filled',
        type: 'rectangle',
        placement: { parentId: 'scene-root', sortKey: 'a0' },
        transform: translation(60, 60),
        geometry: { width: 140, height: 100 },
        appearance: { fill: '#b2f2bb', stroke: '#1e1e1e', strokeWidth: 2 },
      },
    ],
    { measureText: measurement.measure }
  );
  onCleanup(editor.dispose);
  window.canvasEmbeddedFixture = { editor };
  const paragraphs = Array.from({ length: 12 }, (_, index) => index + 1);

  return (
    <main
      data-testid="document"
      class="h-dvh w-full overflow-y-auto bg-panel p-4 text-ink"
    >
      <p class="mb-4">A paragraph above the canvas.</p>
      <div
        data-testid="embed"
        class="relative h-80 overflow-hidden rounded-xl border border-edge-muted"
      >
        <MobileCanvasEmbeddedView editor={editor} fitOnLoad={false} />
      </div>
      <For each={paragraphs}>
        {(number) => <p class="my-8">Paragraph {number} below the canvas.</p>}
      </For>
    </main>
  );
}

document.documentElement.dataset.touchDevice = String(isTouchDevice());
applyTheme('Macro Light');
const root = document.getElementById('root');
if (!root) throw new Error('Fixture root missing');
const client = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});
render(
  () => (
    <QueryClientProvider client={client}>
      <AnalyticsContextProvider>
        <PosthogProvider>
          <Fixture />
        </PosthogProvider>
      </AnalyticsContextProvider>
    </QueryClientProvider>
  ),
  root
);
