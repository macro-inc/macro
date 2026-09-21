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
      expect(
        reorderDatabaseColumns(order, [], columnId, targetId, edge)
      ).toEqual(expected);
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
        reorderDatabaseColumns(order, [], columnId, targetId, edge)
      ).toBeUndefined();
    }
  );

  it('keeps hidden columns in their saved slots in either direction', () => {
    const fullOrder = [
      'hidden-first',
      'name',
      'status',
      'hidden-middle',
      'owner',
      'due',
      'hidden-last',
    ];
    const hidden = ['hidden-first', 'hidden-middle', 'hidden-last'];
    expect(
      reorderDatabaseColumns(fullOrder, hidden, 'name', 'owner', 'after')
    ).toEqual([
      'hidden-first',
      'status',
      'owner',
      'hidden-middle',
      'name',
      'due',
      'hidden-last',
    ]);
    expect(
      reorderDatabaseColumns(fullOrder, hidden, 'due', 'status', 'before')
    ).toEqual([
      'hidden-first',
      'name',
      'due',
      'hidden-middle',
      'status',
      'owner',
      'hidden-last',
    ]);
    expect(fullOrder[3]).toBe('hidden-middle');
  });

  it('ignores hidden endpoints and a drop at the same visible slot', () => {
    expect(
      reorderDatabaseColumns(order, ['status'], 'status', 'due', 'after')
    ).toBeUndefined();
    expect(
      reorderDatabaseColumns(order, ['status'], 'name', 'status', 'after')
    ).toBeUndefined();
    expect(
      reorderDatabaseColumns(order, ['status'], 'name', 'owner', 'before')
    ).toBeUndefined();
    expect(
      reorderDatabaseColumns([], [], 'name', 'owner', 'before')
    ).toBeUndefined();
  });
});

describe('complete schema column order', () => {
  it('includes every lookup placement once while keeping its saved slot', () => {
    const schema = [
      'lookup-first',
      'name',
      'lookup-middle',
      'status',
      'owner',
      'lookup-last',
    ];
    const result = mergeDatabaseColumnOrder(schema, [
      'owner',
      'name',
      'status',
    ]);
    expect(result).toEqual([
      'lookup-first',
      'owner',
      'lookup-middle',
      'name',
      'status',
      'lookup-last',
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
