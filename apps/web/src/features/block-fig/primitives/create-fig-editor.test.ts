import type { EditResult, FigEngine } from '@core/fig-engine/client';
import { createRoot } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { encodeClipboard } from '../core/clipboard';
import { createFigEditor } from './create-fig-editor';
import type { FigViewer } from './create-fig-viewer';

it('queues a paste with no selection before an immediately following edit', async () => {
  const operations: string[] = [];
  const result: EditResult = {
    created: [],
    dirty: null,
    canUndo: true,
    canRedo: false,
    undoStep: 1,
    redoStep: null,
    structure: false,
  };
  const engine = {
    paste: async () => {
      operations.push('paste');
      return result;
    },
    apply: async () => {
      operations.push('edit');
      return result;
    },
    retain: vi.fn(),
  } as unknown as FigEngine;
  const viewer = {
    pages: [{ id: 'page' }],
    page: () => 0,
    selected: () => [],
    camera: () => ({ x: 0, y: 0, zoom: 1 }),
    viewport: () => ({ w: 800, h: 600 }),
    afterEdit: async () => {},
  } as unknown as FigViewer;
  const html = encodeClipboard({
    copied: {
      document: new Uint8Array([1]),
      images: new Uint8Array(),
    },
  });

  await createRoot(async (dispose) => {
    try {
      const notifyError = vi.fn();
      const editor = createFigEditor({
        engine,
        viewer,
        canEdit: () => true,
        stores: () => false,
        onDirty: vi.fn(),
        notifyError,
      });
      const paste = editor.paste(html);
      const edit = editor.apply([
        { op: 'set', ids: ['layer'], props: { name: 'Renamed' } },
      ]);
      await Promise.all([paste, edit]);
      expect(notifyError).not.toHaveBeenCalled();
      expect(operations).toEqual(['paste', 'edit']);
    } finally {
      dispose();
    }
  });
});
