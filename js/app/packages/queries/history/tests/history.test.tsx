import { describe, expect, it, vi } from 'vitest';

vi.mock('@core/constant/allBlocks', () => ({
  itemToSafeName: (item: { name?: string }) => item.name ?? 'Untitled',
}));

import type { Item } from '@service-storage/generated/schemas/item';
import { transformHistoryResponse, updateItemViewedAt } from '../transforms';

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

describe('history transforms', () => {
  it('transforms response and filters instructions.md', () => {
    const data = {
      data: [
        createItem({ id: 'doc-1', name: 'My Doc' }),
        createItem({ id: 'instructions-md', name: 'Instructions' }),
        createItem({ id: 'doc-2', name: 'Other Doc' }),
      ],
    };

    const result = transformHistoryResponse(data, 'instructions-md');

    expect(result.map((i) => i.id)).toEqual(['doc-1', 'doc-2']);
    expect(result[0].name).toBe('My Doc');
  });

  it('updateItemViewedAt sets timestamp for optimistic updates', () => {
    const items = [createItem({ id: 'doc-1' }), createItem({ id: 'doc-2' })];

    const result = updateItemViewedAt(items, 'doc-1', 1704067200000);

    expect(result[0]).toHaveProperty('viewedAt', 1704067200000);
    expect(items[0]).not.toHaveProperty('viewedAt'); // doesn't mutate
  });
});
