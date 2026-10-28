import { describe, expect, it } from 'vitest';
import {
  mergeDatabaseColumnOrder,
  reorderDatabaseColumns,
} from './column-order';

describe('column insertion edges', () => {
  const order = ['name', 'status', 'owner', 'due'];

  it.each([
    ['name', 'owner', 'before', ['status', 'name', 'owner', 'due']],
    ['name', 'owner', 'after', ['status', 'owner', 'name', 'due']],
    ['due', 'status', 'before', ['name', 'due', 'status', 'owner']],
    ['due', 'status', 'after', ['name', 'status', 'due', 'owner']],
    ['name', 'due', 'after', ['status', 'owner', 'due', 'name']],
    ['due', 'name', 'before', ['due', 'name', 'status', 'owner']],
  ] as const)(
    'inserts %s %s at its %s edge',
    (columnId, targetId, edge, expected) => {
      expect(reorderDatabaseColumns(order, columnId, targetId, edge)).toEqual(
        expected
      );
      expect(order).toEqual(['name', 'status', 'owner', 'due']);
    }
  );

  it.each([
    ['name', 'status', 'before'],
    ['status', 'name', 'after'],
    ['owner', 'owner', 'before'],
    ['owner', 'owner', 'after'],
    ['missing', 'name', 'before'],
    ['name', 'missing', 'after'],
  ] as const)(
    'skips unchanged or invalid drops: %s / %s / %s',
    (columnId, targetId, edge) => {
      expect(
        reorderDatabaseColumns(order, columnId, targetId, edge)
      ).toBeUndefined();
    }
  );
});

describe('complete schema column order', () => {
  it('keeps every omitted schema column once in its saved slot', () => {
    const schema = [
      'omitted-first',
      'name',
      'omitted-middle',
      'status',
      'owner',
      'omitted-last',
    ];
    const result = mergeDatabaseColumnOrder(schema, [
      'owner',
      'name',
      'status',
    ]);
    expect(result).toEqual([
      'omitted-first',
      'owner',
      'omitted-middle',
      'name',
      'status',
      'omitted-last',
    ]);
    expect(new Set(result)).toEqual(new Set(schema));
    expect(result).toHaveLength(schema.length);
  });

  it('preserves newly added placements and ignores columns removed before a queued save', () => {
    expect(
      mergeDatabaseColumnOrder(
        ['name', 'new-column', 'status', 'owner'],
        ['owner', 'removed', 'status', 'name']
      )
    ).toEqual(['owner', 'new-column', 'status', 'name']);
  });
});
