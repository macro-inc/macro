import { createRoot, createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';

const invalidatePreview = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@queries/preview', () => ({ invalidatePreview }));

import { refreshChangedItems } from './item-facts';

afterEach(() => invalidatePreview.mockClear());

const renamed = (id: string, itemId: string) => ({
  id,
  card: {
    kind: 'item',
    itemType: 'document',
    itemId,
    fileType: 'md',
    action: 'renamed',
    title: 'Launch plan',
    summary: null,
  },
});

it('loads again what a live step changes, once, and leaves history alone', async () => {
  const [rows, setRows] = createSignal<{ id: string; card?: unknown }[]>([
    renamed('a', 'doc-1'),
    { id: 'b' },
  ]);
  const dispose = createRoot((dispose) => {
    refreshChangedItems(rows);
    return dispose;
  });
  await Promise.resolve();
  expect(invalidatePreview).not.toHaveBeenCalled();

  // The running step finishes, and a new step changes another item.
  setRows([
    renamed('a', 'doc-1'),
    renamed('b', 'doc-2'),
    renamed('c', 'doc-3'),
  ]);
  await Promise.resolve();
  expect(invalidatePreview.mock.calls).toEqual([['doc-2'], ['doc-3']]);

  setRows([
    renamed('a', 'doc-1'),
    renamed('b', 'doc-2'),
    renamed('c', 'doc-3'),
  ]);
  await Promise.resolve();
  expect(invalidatePreview).toHaveBeenCalledTimes(2);
  dispose();
});
