import { describe, expect, it, vi } from 'vitest';

// Mock itemToSafeName before importing
vi.mock('@core/constant/allBlocks', () => ({
  itemToSafeName: (item: { name?: string }) => item.name ?? 'Untitled',
}));

import {
  filterInstructionsMd,
  transformHistoryItem,
  transformHistoryResponse,
  updateItemViewedAt,
} from '../transforms';
import type { Item } from '@service-storage/generated/schemas/item';

function createItem(overrides: Partial<Item> = {}): Item {
  return {
    id: `item-${Math.random().toString(36).slice(2)}`,
    name: 'Test Item',
    type: 'document',
    userId: 'user-1',
    createdAt: Date.now() / 1000,
    updatedAt: Date.now() / 1000,
    ...overrides,
  } as Item;
}

describe('filterInstructionsMd', () => {
  it('filters out item matching instructionsId', () => {
    const items = [
      createItem({ id: 'doc-1' }),
      createItem({ id: 'instructions-md' }),
      createItem({ id: 'doc-2' }),
    ];

    const result = filterInstructionsMd(items, 'instructions-md');

    expect(result).toHaveLength(2);
    expect(result.map((i) => i.id)).toEqual(['doc-1', 'doc-2']);
  });

  it('returns all items when instructionsId is null', () => {
    const items = [createItem({ id: 'doc-1' }), createItem({ id: 'doc-2' })];

    const result = filterInstructionsMd(items, null);

    expect(result).toHaveLength(2);
  });

  it('returns all items when instructionsId is undefined', () => {
    const items = [createItem({ id: 'doc-1' }), createItem({ id: 'doc-2' })];

    const result = filterInstructionsMd(items, undefined);

    expect(result).toHaveLength(2);
  });

  it('returns all items when no item matches instructionsId', () => {
    const items = [createItem({ id: 'doc-1' }), createItem({ id: 'doc-2' })];

    const result = filterInstructionsMd(items, 'non-existent');

    expect(result).toHaveLength(2);
  });

  it('handles empty array', () => {
    const result = filterInstructionsMd([], 'instructions-md');

    expect(result).toEqual([]);
  });
});

describe('updateItemViewedAt', () => {
  it('updates viewedAt for matching item', () => {
    const items = [createItem({ id: 'doc-1' }), createItem({ id: 'doc-2' })];
    const timestamp = 1704067200000;

    const result = updateItemViewedAt(items, 'doc-1', timestamp);

    expect(result[0]).toHaveProperty('viewedAt', timestamp);
    expect(result[1]).not.toHaveProperty('viewedAt');
  });

  it('does not mutate original array', () => {
    const items = [createItem({ id: 'doc-1' })];
    const timestamp = 1704067200000;

    const result = updateItemViewedAt(items, 'doc-1', timestamp);

    expect(result).not.toBe(items);
    expect(result[0]).not.toBe(items[0]);
    expect(items[0]).not.toHaveProperty('viewedAt');
  });

  it('returns unchanged array when itemId not found', () => {
    const items = [createItem({ id: 'doc-1' }), createItem({ id: 'doc-2' })];
    const timestamp = 1704067200000;

    const result = updateItemViewedAt(items, 'non-existent', timestamp);

    expect(result[0]).not.toHaveProperty('viewedAt');
    expect(result[1]).not.toHaveProperty('viewedAt');
  });

  it('handles empty array', () => {
    const result = updateItemViewedAt([], 'doc-1', 1704067200000);

    expect(result).toEqual([]);
  });

  it('overwrites existing viewedAt', () => {
    const items = [createItem({ id: 'doc-1' })];
    (items[0] as Item & { viewedAt?: number }).viewedAt = 1000;
    const newTimestamp = 2000;

    const result = updateItemViewedAt(items, 'doc-1', newTimestamp);

    expect(result[0]).toHaveProperty('viewedAt', newTimestamp);
  });
});

describe('transformHistoryItem', () => {
  it('adds computed name from itemToSafeName', () => {
    const item = createItem({ name: 'My Document' });

    const result = transformHistoryItem(item);

    expect(result.name).toBe('My Document');
  });

  it('preserves viewedAt if present', () => {
    const item = createItem();
    (item as Item & { viewedAt?: number }).viewedAt = 1704067200000;

    const result = transformHistoryItem(item);

    expect(result.viewedAt).toBe(1704067200000);
  });

  it('viewedAt is undefined when not present', () => {
    const item = createItem();

    const result = transformHistoryItem(item);

    expect(result.viewedAt).toBeUndefined();
  });
});

describe('transformHistoryResponse', () => {
  it('filters and transforms in one pass', () => {
    const data = {
      data: [
        createItem({ id: 'doc-1', name: 'Doc 1' }),
        createItem({ id: 'instructions', name: 'Instructions' }),
        createItem({ id: 'doc-2', name: 'Doc 2' }),
      ],
    };

    const result = transformHistoryResponse(data, 'instructions');

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('doc-1');
    expect(result[0].name).toBe('Doc 1');
    expect(result[1].id).toBe('doc-2');
    expect(result[1].name).toBe('Doc 2');
  });

  it('transforms all items when no instructionsId', () => {
    const data = {
      data: [
        createItem({ id: 'doc-1', name: 'Doc 1' }),
        createItem({ id: 'doc-2', name: 'Doc 2' }),
      ],
    };

    const result = transformHistoryResponse(data, null);

    expect(result).toHaveLength(2);
  });

  it('handles empty data', () => {
    const result = transformHistoryResponse({ data: [] }, 'instructions');

    expect(result).toEqual([]);
  });
});
