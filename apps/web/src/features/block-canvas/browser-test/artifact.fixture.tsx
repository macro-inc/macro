import '../../../index.css';
import { createScene, type ShapeItem, translation } from '@macro-inc/graphics';
import { queryClient } from '@queries/client';
import { QueryClientProvider } from '@tanstack/solid-query';
import { DragDropProvider } from '@thisbeyond/solid-dnd';
import { render } from 'solid-js/web';
import { CanvasDocument } from '../component/CanvasDocument';

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
const file = new Blob(
  [
    JSON.stringify({
      version: 2,
      document: createScene([
        artifact('Second', 500, 'a1'),
        artifact('First', 100, 'a0'),
      ]),
    }),
  ],
  { type: 'application/x-macro-canvas' }
);
const editable = new URLSearchParams(location.search).has('edit');

render(
  () => (
    <div style={{ width: '100vw', height: '100vh' }}>
      <QueryClientProvider client={queryClient}>
        <DragDropProvider>
          <CanvasDocument
            documentId="canvas"
            file={file}
            canEdit={editable}
            isNested={!editable}
            view={{ x: 0, y: 0, scale: 100 }}
          />
        </DragDropProvider>
      </QueryClientProvider>
    </div>
  ),
  document.getElementById('app')!
);
