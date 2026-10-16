import { createScene, translation } from '@macro-inc/graphics';
import { expect, it, vi } from 'vitest';
import type { CanvasFile } from '../core/document-format';
import { readCanvasFile } from '../core/document-format';
import { createTrackedCanvasDocumentSource } from './create-tracked-document-source';

function canvas(...targets: string[]): CanvasFile {
  return {
    version: 2,
    document: createScene(
      targets.map((target, index) => ({
        id: `shape-${index}`,
        type: 'document' as const,
        placement: { parentId: 'scene-root', sortKey: `a${index}` },
        transform: translation(0, 0),
        appearance: { fill: 'none', stroke: 'none' },
        geometry: {
          documentId: target,
          name: target,
          fileType: 'md',
          width: 340,
          height: 136,
        },
      }))
    ),
  };
}
function setup(initial = canvas()) {
  const create = vi.fn(
    async (target: string) => `${target}-${create.mock.calls.length}`
  );
  const remove = vi.fn(async (_id: string) => {});
  const save = vi.fn(async (_file: CanvasFile) => new Blob());
  const canEdit = vi.fn(() => true);
  const source = createTrackedCanvasDocumentSource(
    'source',
    initial,
    { canEdit, save },
    { create, remove }
  );
  return { source, create, remove, save, canEdit };
}

it('tracks one mention per target and preserves IDs across saves and reopening', async () => {
  const s = setup();
  await s.source.save(canvas('a', 'a', 'b'));
  expect(s.create.mock.calls).toEqual([['a'], ['b']]);
  const saved = readCanvasFile(s.save.mock.calls[0]![0]);
  expect(saved.referenceTracking?.mentions).toHaveLength(2);
  await s.source.save(canvas('a', 'b'));
  expect(s.remove).not.toHaveBeenCalled();
  expect(s.create).toHaveBeenCalledTimes(2);
  const reopened = setup(saved);
  await reopened.source.save(canvas('a', 'b'));
  expect(reopened.create).not.toHaveBeenCalled();
});

it('untracks only after the last card is saved as removed and registers undo/redo', async () => {
  const s = setup();
  await s.source.save(canvas('a', 'a'));
  await s.source.save(canvas('a'));
  expect(s.remove).not.toHaveBeenCalled();
  await s.source.save(canvas());
  expect(
    s.save.mock.calls.at(-1)?.[0].referenceTracking?.pendingRemoval
  ).toEqual(['a-1']);
  expect(s.remove).toHaveBeenCalledWith('a-1');
  expect(s.save.mock.invocationCallOrder.at(-1)!).toBeLessThan(
    s.remove.mock.invocationCallOrder[0]!
  );
  await s.source.save(canvas('a'));
  expect(s.create).toHaveBeenCalledTimes(2);
  await s.source.save(canvas());
  expect(s.remove).toHaveBeenLastCalledWith('a-2');
});

it('keeps IDs across failed saves and defers untracking until a successful retry', async () => {
  const s = setup();
  s.save.mockRejectedValueOnce(new Error('offline'));
  await expect(s.source.save(canvas('a'))).rejects.toThrow('offline');
  await s.source.save(canvas('a'));
  expect(s.create).toHaveBeenCalledOnce();
  s.save.mockRejectedValueOnce(new Error('offline'));
  await expect(s.source.save(canvas())).rejects.toThrow('offline');
  expect(s.remove).not.toHaveBeenCalled();
  await s.source.save(canvas());
  expect(s.remove).toHaveBeenCalledWith('a-1');
});

it('persists pending removals so a reopened file can retry failed cleanup', async () => {
  const s = setup();
  await s.source.save(canvas('a'));
  s.remove.mockRejectedValueOnce(new Error('offline'));
  await expect(s.source.save(canvas())).rejects.toThrow('offline');
  const reopened = setup(s.save.mock.calls.at(-1)![0]);
  await reopened.source.save(canvas());
  expect(reopened.remove).toHaveBeenCalledWith('a-1');
  await reopened.source.save(canvas());
  expect(
    reopened.save.mock.calls.at(-1)?.[0].referenceTracking?.pendingRemoval
  ).toEqual([]);
});

it('does not use another canvas’s tracking IDs or mutate read-only documents', async () => {
  const initial = canvas('a');
  const s = setup({
    ...initial,
    referenceTracking: {
      sourceId: 'other',
      mentions: [{ targetId: 'a', mentionId: 'foreign' }],
      pendingRemoval: ['foreign-old'],
    },
  });
  await s.source.save(initial);
  expect(s.create).toHaveBeenCalledWith('a');
  expect(s.remove).not.toHaveBeenCalled();
  s.canEdit.mockReturnValue(false);
  await expect(s.source.save(canvas())).rejects.toThrow('read-only');
  expect(s.remove).not.toHaveBeenCalled();
  expect(s.save).toHaveBeenCalledOnce();
});

it('retries a failed registration without creating duplicates for earlier targets', async () => {
  const s = setup();
  s.create
    .mockResolvedValueOnce('mention-a')
    .mockRejectedValueOnce(new Error('offline'));
  await expect(s.source.save(canvas('a', 'b'))).rejects.toThrow('offline');
  await s.source.save(canvas('a', 'b'));
  expect(s.create.mock.calls).toEqual([['a'], ['b'], ['b']]);
});
