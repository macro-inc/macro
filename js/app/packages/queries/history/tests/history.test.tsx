import { describe, expect, it, vi } from 'vitest';

vi.mock('@core/constant/allBlocks', () => ({
  itemToSafeName: (item: { name?: string }) => item.name ?? 'Untitled',
}));

import type { Item } from '@service-storage/generated/schemas/item';
import {
  transformHistoryResponse,
  updateViewedAtAndMoveItemToFront,
} from '../transforms';

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

  describe('updateViewedAtAndMoveItemToFront', () => {
    it('moves item to front and updates viewedAt', () => {
      const items: Item[] = [
        createItem({ id: 'item-1' }),
        createItem({ id: 'item-2' }),
        createItem({ id: 'item-3' }),
      ];
      const timestamp = Date.now();

      const result = updateViewedAtAndMoveItemToFront(
        items,
        'item-2',
        timestamp
      );

      expect(result[0].id).toBe('item-2');
      expect(result[0].viewedAt).toBe(timestamp);
      expect(result[1].id).toBe('item-1');
      expect(result[2].id).toBe('item-3');
    });

    it('returns original array if item not found', () => {
      const items: Item[] = [
        createItem({ id: 'item-1' }),
        createItem({ id: 'item-2' }),
      ];

      const result = updateViewedAtAndMoveItemToFront(
        items,
        'nonexistent',
        Date.now()
      );

      expect(result).toBe(items);
      expect(result.length).toBe(2);
    });

    it('keeps item at front if already first', () => {
      const items: Item[] = [
        createItem({ id: 'item-1' }),
        createItem({ id: 'item-2' }),
      ];
      const timestamp = Date.now();

      const result = updateViewedAtAndMoveItemToFront(
        items,
        'item-1',
        timestamp
      );

      expect(result[0].id).toBe('item-1');
      expect(result[0].viewedAt).toBe(timestamp);
      expect(result[1].id).toBe('item-2');
    });

    it('does not mutate original array', () => {
      const items: Item[] = [
        createItem({ id: 'item-1' }),
        createItem({ id: 'item-2' }),
      ];
      const originalLength = items.length;

      updateViewedAtAndMoveItemToFront(items, 'item-2', Date.now());

      expect(items.length).toBe(originalLength);
      expect(items[0].id).toBe('item-1');
    });
  });
});
