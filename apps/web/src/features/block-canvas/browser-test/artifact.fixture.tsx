import '../../../index.css';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { UserContextProvider } from '@core/context/user';
import { createScene, type ShapeItem, translation } from '@macro-inc/graphics';
import { queryClient } from '@queries/client';
import { QueryClientProvider } from '@tanstack/solid-query';
import { DragDropProvider } from '@thisbeyond/solid-dnd';
import { render } from 'solid-js/web';
import { CanvasNextEditor } from '../canvas-next';

const artifact = (
  id: string,
  x: number,
  presentOrder: string
): ShapeItem<'artifact'> => ({
  id,
  type: 'artifact',
  placement: { parentId: 'scene-root', sortKey: presentOrder },
  transform: translation(x, 100),
  appearance: { fill: 'transparent', stroke: 'transparent' },
  geometry: {
    width: 320,
    height: 180,
    title: id,
    html: `<button id="target" onclick="this.textContent='clicked'">${id}</button>`,
    designWidth: 640,
    designHeight: 360,
    presentOrder,
  },
});
const initial = {
  version: 2,
  document: createScene([
    artifact('First', 100, 'a0'),
    artifact('Second', 500, 'a1'),
  ]),
} as const;
const editable = new URLSearchParams(location.search).has('edit');

render(
  () => (
    <div style={{ width: '100vw', height: '100vh' }}>
      <AnalyticsContextProvider>
        <PosthogProvider>
          <QueryClientProvider client={queryClient}>
            <UserContextProvider>
              <DragDropProvider>
                <CanvasNextEditor
                  documentId="canvas"
                  initial={initial}
                  canEdit={editable}
                  fitOnLoad={false}
                />
              </DragDropProvider>
            </UserContextProvider>
          </QueryClientProvider>
        </PosthogProvider>
      </AnalyticsContextProvider>
    </div>
  ),
  document.getElementById('app')!
);
