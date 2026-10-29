import {
  createGraphicsEditorFromBackend,
  createScene,
  translation,
} from '@macro-inc/graphics';
import { createLoroGraphicsBackendFromDoc } from '@macro-inc/graphics/loro';
import { LoroDoc } from 'loro-crdt';
import { createRoot } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { createCanvasSeed, readSharedCanvas } from '../core/collaboration';
import { createSharedReferenceTracking } from './create-shared-reference-tracking';

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups
    .splice(0)
    .reverse()
    .forEach((close) => close());
  vi.useRealTimers();
});
it('keeps reference retirement durable until the scene reaches the server, then retries it on reopen', async () => {
  vi.useFakeTimers();
  const doc = new LoroDoc();
  doc.import(
    createCanvasSeed(
      {
        version: 2,
        document: createScene([
          {
            id: 'card',
            type: 'document',
            placement: { parentId: 'scene-root', sortKey: 'a0' },
            transform: translation(0, 0),
            appearance: { fill: 'none', stroke: 'none' },
            geometry: {
              documentId: 'target',
              fileType: 'md',
              name: 'Target',
              width: 340,
              height: 136,
            },
          },
        ]),
      },
      'source'
    )
  );
  const backend = createLoroGraphicsBackendFromDoc(doc, 'scene-root');
  const editor = createGraphicsEditorFromBackend(backend);
  cleanups.push(() => {
    editor.dispose();
    backend.dispose();
    doc.free();
  });
  const create = vi.fn(async () => 'mention-1');
  const remove = vi.fn(async () => {});
  const delivered = vi.fn(async () => false);
  let stop = () => {};
  createRoot((dispose) => {
    stop = dispose;
    cleanups.push(dispose);
    createSharedReferenceTracking(doc, 'source', () => true, delivered, {
      create,
      remove,
    });
  });
  await vi.advanceTimersByTimeAsync(500);
  expect(create).toHaveBeenCalledOnce();
  expect(editor.getSession().canUndo).toBe(false);
  editor.select('card');
  editor.deleteSelection();
  await vi.advanceTimersByTimeAsync(500);
  expect(remove).not.toHaveBeenCalled();
  expect(
    readSharedCanvas(doc, 'source').referenceTracking?.pendingRemoval
  ).toEqual(['mention-1']);
  stop();
  delivered.mockResolvedValue(true);
  createRoot((dispose) => {
    cleanups.push(dispose);
    createSharedReferenceTracking(doc, 'source', () => true, delivered, {
      create,
      remove,
    });
  });
  await vi.advanceTimersByTimeAsync(500);
  expect(remove).toHaveBeenCalledWith('mention-1');
  expect(
    readSharedCanvas(doc, 'source').referenceTracking?.pendingRemoval
  ).toEqual([]);
});
it('a copied shared document exports no reference ids owned by the source canvas', () => {
  const doc = new LoroDoc();
  doc.import(
    createCanvasSeed(
      {
        version: 2,
        document: createScene([]),
        referenceTracking: {
          sourceId: 'source',
          mentions: [{ targetId: 'target', mentionId: 'original-mention' }],
          pendingRemoval: ['original-retiring'],
        },
      },
      'source'
    )
  );
  try {
    expect(readSharedCanvas(doc, 'copy').referenceTracking).toEqual({
      sourceId: 'copy',
      mentions: [],
      pendingRemoval: [],
    });
  } finally {
    doc.free();
  }
});
