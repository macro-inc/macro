import { describe, expect, it, vi } from 'vitest';
import type { Item } from '@service-storage/generated/schemas/item';
import {
  transformHistoryItem,
  transformHistoryResponse,
  updateViewedAtAndMoveItemToFront,
} from '../transforms';

vi.mock('@core/constant/allBlocks', () => ({
  itemToSafeName: (item: { name?: string }) => item.name || 'Untitled',
}));

function createItem(overrides: Partial<Item> = {}): Item {
  return {
    id: `item-${Math.random().toString(36).slice(2)}`,
    name: 'Test Item',
    type: 'document',
    userId: 'user-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as Item;
}

function createHistoryItem(overrides: Partial<Item> = {}) {
  return transformHistoryItem(createItem(overrides));
}

describe('history transforms', () => {
  it('transforms response', () => {
    const data = {
      data: [
        createItem({ id: 'doc-1', name: 'My Doc' }),
        createItem({ id: 'doc-2', name: 'Other Doc' }),
      ],
    };

    const result = transformHistoryResponse(data);

    expect(result.map((i) => i.id)).toEqual(['doc-1', 'doc-2']);
    expect(result[0].name).toBe('My Doc');
  });

  it('keeps raw name for md documents', () => {
    const data = {
      data: [createItem({ id: 'doc-1', name: '', fileType: 'md' })],
    };

    console.log('data', data);

    const result = transformHistoryResponse(data);

    expect(result[0].name).toBe('Untitled');
    expect(result[0].rawName).toBe('');
  });

  describe('updateViewedAtAndMoveItemToFront', () => {
    it('moves item to front and updates viewedAt', () => {
      const items = [
        createHistoryItem({ id: 'item-1' }),
        createHistoryItem({ id: 'item-2' }),
        createHistoryItem({ id: 'item-3' }),
      ];
      const timestamp = new Date();

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
      const items = [
        createHistoryItem({ id: 'item-1' }),
        createHistoryItem({ id: 'item-2' }),
      ];

      const result = updateViewedAtAndMoveItemToFront(
        items,
        'nonexistent',
        new Date()
      );

      expect(result).toBe(items);
      expect(result.length).toBe(2);
    });

    it('keeps item at front if already first', () => {
      const items = [
        createHistoryItem({ id: 'item-1' }),
        createHistoryItem({ id: 'item-2' }),
      ];
      const timestamp = new Date();

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
      const items = [
        createHistoryItem({ id: 'item-1' }),
        createHistoryItem({ id: 'item-2' }),
      ];
      const originalLength = items.length;

      updateViewedAtAndMoveItemToFront(items, 'item-2', new Date());

      expect(items.length).toBe(originalLength);
      expect(items[0].id).toBe('item-1');
    });
  });
});
