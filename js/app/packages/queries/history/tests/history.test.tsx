import { describe, expect, it, vi } from 'vitest';
import type { Item } from '@service-storage/generated/schemas/item';
import { transformHistoryResponse } from '../transforms';

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
});
