import '@fontsource-variable/inter';
import '@app/index.css';
import { applyTheme } from '@app/features/theme/utils/themeUtils';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { FloatRegion } from '@components/app/mobile/float-regions/FloatRegion';
import { FloatRegionHost } from '@components/app/mobile/float-regions/FloatRegionHost';
import { useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import {
  createGraphicsEditor,
  type GraphicsEditor,
  screenToWorld,
  translation,
} from '@macro-inc/graphics';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { DragDropProvider } from '@thisbeyond/solid-dnd';
import { onCleanup, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { createCanvasClipboard } from '../clipboard';
import type { CanvasAssetSource } from '../core/assets';
import { createAssetState } from '../primitives/create-asset-state';
import {
  type CanvasState,
  createCanvasState,
} from '../primitives/create-canvas-state';
import { createCanvasInsertState } from '../primitives/create-insert-state';
import { MobileCanvasView } from '../views/mobile/canvas-view';
import { createCanvasTextMeasurer } from '../views/text-content';

declare global {
  interface Window {
    canvasTouchFixture: {
      editor: GraphicsEditor;
      state: CanvasState;
      /** Names of the files handed to the upload source, in order. */
      uploads: string[];
    };
  }
}

const uploads: string[] = [];

// Nothing is stored here: an upload is only recorded, so a test can see which
// files the Attach menu handed over.
const NO_ASSETS: CanvasAssetSource = {
  upload: (file) => {
    uploads.push(file.name);
    return Promise.reject(new Error('No uploads in this fixture'));
  },
  media: () => Promise.reject(new Error('No media in this fixture')),
};

// `?chrome=none` is a page without the app's bottom chrome, as a public link
// opened signed out is.
const HAS_APP_CHROME =
  new URLSearchParams(location.search).get('chrome') !== 'none';

/**
 * The editable canvas as a phone or tablet shows it: the real touch view and
 * the real bottom-chrome host, over a stand-in dock and a stand-in for the
 * page's New button. No session, sync or services.
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
        transform: translation(60, 160),
        geometry: { width: 140, height: 100 },
        appearance: { fill: '#b2f2bb', stroke: '#1e1e1e', strokeWidth: 2 },
      },
      {
        id: 'outline',
        type: 'ellipse',
        placement: { parentId: 'scene-root', sortKey: 'a1' },
        transform: translation(60, 320),
        geometry: { width: 140, height: 100 },
        appearance: { fill: 'transparent', stroke: '#1e1e1e', strokeWidth: 2 },
      },
    ],
    { measureText: measurement.measure }
  );
  onCleanup(editor.dispose);
  const state = createCanvasState(editor, measurement.measure);
  const assets = createAssetState(state, NO_ASSETS);
  const insert = createCanvasInsertState(editor.getCamera);
  let viewport: HTMLElement | undefined;
  const center = () =>
    screenToWorld(editor.getCamera(), {
      x: (viewport?.clientWidth ?? 0) / 2,
      y: (viewport?.clientHeight ?? 0) / 2,
    });
  const clipboard = createCanvasClipboard(
    editor,
    state.setNotice,
    undefined,
    undefined,
    { canvasId: 'touch-fixture', center }
  );
  const [attachScope, scopeId] = useHotkeyDOMScope('canvas-next');
  window.canvasTouchFixture = { editor, state, uploads };

  return (
    <div class="relative h-dvh w-full overflow-hidden bg-panel">
      <MobileCanvasView
        fitOnLoad={false}
        state={state}
        scopeId={scopeId}
        embedView={() => null}
        clipboard={clipboard}
        assets={assets}
        insert={insert}
        onViewport={(element) => {
          viewport = element;
        }}
        onOpenDocument={() => {}}
        attachScope={attachScope}
      />
      <Show when={HAS_APP_CHROME}>
        <FloatRegionHost />
        <FloatRegion region="accessory" priority={-1}>
          <div class="flex justify-end px-(--mobile-chrome-gutter)">
            <button
              type="button"
              class="island pointer-events-auto rounded-full px-4"
            >
              New
            </button>
          </div>
        </FloatRegion>
        <FloatRegion region="dock">
          <div class="px-(--mobile-chrome-gutter)">
            <div
              data-testid="dock"
              class="island pointer-events-auto h-(--mobile-chrome-button-size) w-full rounded-full"
            />
          </div>
        </FloatRegion>
      </Show>
    </div>
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
          {/* The canvas registers itself as a drop target for workspace items. */}
          <DragDropProvider>
            <Fixture />
          </DragDropProvider>
        </PosthogProvider>
      </AnalyticsContextProvider>
    </QueryClientProvider>
  ),
  root
);
