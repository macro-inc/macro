import '../../../index.css';
import { createScene, type ShapeItem, translation } from '@macro-inc/graphics';
import { queryClient } from '@queries/client';
import { QueryClientProvider } from '@tanstack/solid-query';
import { DragDropProvider } from '@thisbeyond/solid-dnd';
import { render } from 'solid-js/web';
import { CanvasDocument } from '../component/CanvasDocument';

declare global {
  interface Window {
    canvasFixture: { opens: number };
  }
}

window.canvasFixture = { opens: 0 };
const reference: ShapeItem<'document'> = {
  id: 'reference',
  type: 'document',
  placement: { parentId: 'scene-root', sortKey: 'a0' },
  transform: translation(100, 100),
  appearance: { fill: 'transparent', stroke: 'transparent' },
  geometry: {
    width: 320,
    height: 240,
    documentId: 'referenced-doc',
    fileType: 'md',
    name: 'Referenced document',
  },
};
const file = new Blob(
  [JSON.stringify({ version: 2, document: createScene([reference]) })],
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
            view={editable ? { x: 0, y: 0, scale: 100 } : undefined}
          />
        </DragDropProvider>
      </QueryClientProvider>
    </div>
  ),
  document.getElementById('app')!
);
