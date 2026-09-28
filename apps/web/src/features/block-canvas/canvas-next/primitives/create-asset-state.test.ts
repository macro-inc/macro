import {
  copyFragment,
  createGraphicsEditor,
  drawableIds,
  parseFragment,
  pasteCommand,
} from '@macro-inc/graphics';
import { createRoot } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type { CanvasAssetSource, PreparedMedia } from '../core/assets';
import { setDocumentDisplayCommand } from '../core/document-display';
import { createAssetState } from './create-asset-state';
import { createCanvasState } from './create-canvas-state';

const disposers: (() => void)[] = [];
afterEach(() => disposers.splice(0).forEach((fn) => fn()));
const media: PreparedMedia = {
  type: 'image',
  geometry: {
    width: 200,
    height: 100,
    name: 'image',
    source: { type: 'static', id: 'asset' },
  },
};
function setup(source: CanvasAssetSource) {
  return createRoot((dispose) => {
    disposers.push(dispose);
    const editor = createGraphicsEditor();
    disposers.push(editor.dispose);
    const canvas = createCanvasState(editor, (g) => ({
      width: g.width,
      height: g.height,
    }));
    return { editor, assets: createAssetState(canvas, source), canvas };
  });
}
it('batches file inserts as one undo entry and preserves stable references on redo', async () => {
  const { editor, assets } = setup({
    upload: vi.fn(async () => media),
    media: vi.fn(async () => media),
  });
  await assets.files([new File(['a'], 'a.png'), new File(['b'], 'b.png')], {
    x: 300,
    y: 200,
  });
  expect(drawableIds(editor.document)).toHaveLength(2);
  expect(editor.document.items[drawableIds(editor.document)[0]!]).toMatchObject(
    {
      transform: [1, 0, 0, 1, 200, 150],
      geometry: { source: { type: 'static', id: 'asset' } },
    }
  );
  editor.undo();
  expect(drawableIds(editor.document)).toHaveLength(0);
  expect(editor.getSession().canUndo).toBe(false);
  editor.redo();
  expect(drawableIds(editor.document)).toHaveLength(2);
});
it('does not insert an async upload after resetting the demo', async () => {
  let resolve!: (value: PreparedMedia) => void;
  const { editor, assets } = setup({
    upload: () =>
      new Promise((r) => {
        resolve = r;
      }),
    media: vi.fn(async () => media),
  });
  const pending = assets.files([new File(['a'], 'a.png')], { x: 0, y: 0 });
  assets.cancelPending();
  resolve(media);
  await pending;
  expect(drawableIds(editor.document)).toHaveLength(0);
  expect(assets.busy()).toBe(0);
});
it('reports a failed file without discarding successful files or leaving pending state', async () => {
  const { editor, assets, canvas } = setup({
    upload: async (file) => {
      if (file.name === 'bad') throw Error('bad');
      return media;
    },
    media: vi.fn(async () => media),
  });
  await assets.files([new File(['a'], 'good'), new File(['b'], 'bad')], {
    x: 0,
    y: 0,
  });
  expect(drawableIds(editor.document)).toHaveLength(1);
  expect(canvas.notice()).toContain('1 could not be loaded');
  expect(assets.busy()).toBe(0);
});

it('keeps embed presentation in copy/undo while input ownership stays local', () => {
  const { editor, assets, canvas } = setup({
    upload: vi.fn(async () => media),
    media: vi.fn(async () => media),
  });
  assets.document(
    { id: 'existing-doc', name: 'Note', fileType: 'md' },
    { x: 320, y: 240 },
    'embed'
  );
  const id = editor.getSession().selectedId!;
  const item = editor.document.items[id];
  expect(item).toMatchObject({
    type: 'document',
    geometry: { display: 'embed', width: 640, height: 480 },
  });
  canvas.embeds.enter(id);
  expect(canvas.embeds.active()).toBe(id);
  canvas.chooseTool('rectangle');
  expect(canvas.embeds.active()).toBeUndefined();
  const fragment = parseFragment(
    JSON.stringify(copyFragment(editor.document, [id]))
  )!;
  editor.execute(pasteCommand, { fragment, createId: () => 'copy' });
  expect(editor.document.items.copy).toMatchObject({
    geometry: { documentId: 'existing-doc', display: 'embed' },
  });
  expect(canvas.embeds.active()).toBeUndefined();
  editor.undo();
  canvas.embeds.enter(id);
  editor.execute(setDocumentDisplayCommand, { id, display: 'preview' });
  expect(canvas.embeds.active()).toBeUndefined();
  editor.undo();
  expect(editor.document.items[id]).toMatchObject({
    geometry: { display: 'embed' },
  });
  editor.deleteSelection();
  expect(canvas.embeds.active()).toBeUndefined();
});
it('admits documents and canvases as embeds but leaves unsupported references alone', () => {
  const { editor, assets, canvas } = setup({
    upload: vi.fn(async () => media),
    media: vi.fn(async () => media),
  });
  assets.document(
    { id: 'nested', name: 'Board', fileType: 'canvas' },
    { x: 0, y: 0 },
    'embed'
  );
  canvas.embeds.enter(editor.getSession().selectedId!);
  expect(canvas.embeds.active()).toBeDefined();
  assets.document(
    { id: 'pdf', name: 'PDF', fileType: 'pdf' },
    { x: 0, y: 0 },
    'embed'
  );
  expect(drawableIds(editor.document)).toHaveLength(1);
  assets.document({ id: 'pdf', name: 'PDF', fileType: 'pdf' }, { x: 0, y: 0 });
  const id = editor.getSession().selectedId!;
  editor.execute(setDocumentDisplayCommand, { id, display: 'embed' });
  canvas.embeds.enter(id);
  expect(canvas.embeds.active()).toBeUndefined();
  expect(editor.document.items[id]).toMatchObject({
    geometry: { display: 'preview' },
  });
});
