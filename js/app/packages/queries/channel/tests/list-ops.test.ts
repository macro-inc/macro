import { describe, expect, it } from 'vitest';
import {
  captureItemSnapshotById,
  insertItemIfMissing,
  removeItemById,
  replaceItemId,
  restoreItemSnapshot,
  type ListItemSnapshot,
} from '../list-ops';

type Item = {
  id: string;
  content: string;
};

function createItem(id: string, content = id): Item {
  return { id, content };
}

describe('insertItemIfMissing', () => {
  it('initializes an empty collection with the inserted item', () => {
    expect(insertItemIfMissing(undefined, createItem('reply-1'))).toEqual([
      createItem('reply-1'),
    ]);
  });

  it('appends a new item and preserves existing order', () => {
    expect(
      insertItemIfMissing(
        [createItem('reply-1'), createItem('reply-2')],
        createItem('reply-3')
      )
    ).toEqual([
      createItem('reply-1'),
      createItem('reply-2'),
      createItem('reply-3'),
    ]);
  });

  it('returns the same array when the item already exists', () => {
    const existing = [createItem('reply-1'), createItem('reply-2')];

    expect(insertItemIfMissing(existing, createItem('reply-2'))).toBe(existing);
  });
});

describe('removeItemById', () => {
  it('removes the matching item', () => {
    expect(
      removeItemById([createItem('reply-1'), createItem('reply-2')], 'reply-1')
    ).toEqual([createItem('reply-2')]);
  });

  it('returns the same array when the item is missing', () => {
    const existing = [createItem('reply-1')];

    expect(removeItemById(existing, 'missing')).toBe(existing);
  });
});

describe('replaceItemId', () => {
  it('replaces an optimistic id and preserves the rest of the item', () => {
    expect(
      replaceItemId(
        [createItem('optimistic-reply', 'hello')],
        'optimistic-reply',
        'real-reply'
      )
    ).toEqual([createItem('real-reply', 'hello')]);
  });

  it('returns the same array when there is no matching optimistic id', () => {
    const existing = [createItem('reply-1')];

    expect(replaceItemId(existing, 'missing', 'real-reply')).toBe(existing);
  });
});

describe('captureItemSnapshotById', () => {
  it('captures the original index and item for rollback', () => {
    expect(
      captureItemSnapshotById(
        [createItem('reply-1'), createItem('reply-2')],
        'reply-2'
      )
    ).toEqual<ListItemSnapshot<Item>>({
      index: 1,
      item: createItem('reply-2'),
    });
  });

  it('returns undefined when the item is missing', () => {
    expect(
      captureItemSnapshotById([createItem('reply-1')], 'missing')
    ).toBeUndefined();
  });
});

describe('restoreItemSnapshot', () => {
  it('restores a removed item at its original index', () => {
    expect(
      restoreItemSnapshot([createItem('reply-1')], {
        index: 1,
        item: createItem('reply-2'),
      })
    ).toEqual([createItem('reply-1'), createItem('reply-2')]);
  });

  it('initializes an empty collection from a snapshot', () => {
    expect(
      restoreItemSnapshot(undefined, {
        index: 0,
        item: createItem('reply-1'),
      })
    ).toEqual([createItem('reply-1')]);
  });

  it('returns the same array when the item is already present', () => {
    const existing = [createItem('reply-1'), createItem('reply-2')];

    expect(
      restoreItemSnapshot(existing, {
        index: 1,
        item: createItem('reply-2'),
      })
    ).toBe(existing);
  });
});
