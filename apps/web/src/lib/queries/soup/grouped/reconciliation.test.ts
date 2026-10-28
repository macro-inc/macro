import { describe, expect, it } from 'vitest';
import { reconcileGroupedSoup } from './reconciliation';

const baseline = [
  {
    key: 'todo',
    totalCount: 30,
    itemIds: ['a', 'b'],
    nextCursor: 'todo-page-2',
  },
  { key: 'done', totalCount: 10, itemIds: ['c'], nextCursor: 'done-page-2' },
];

describe('baseline-backed grouped Soup reconciliation', () => {
  it('moves loaded rows without replacing server totals with loaded counts', () => {
    expect(
      reconcileGroupedSoup(baseline, [
        { id: 'a', previousGroupKeys: ['todo'], groupKeys: ['done'] },
        { id: 'b', previousGroupKeys: ['todo'], groupKeys: ['todo'] },
        { id: 'c', previousGroupKeys: ['done'], groupKeys: ['done'] },
      ])
    ).toEqual([
      {
        key: 'todo',
        totalCount: 29,
        itemIds: ['b'],
        nextCursor: 'todo-page-2',
      },
      {
        key: 'done',
        totalCount: 11,
        itemIds: ['a', 'c'],
        nextCursor: 'done-page-2',
      },
    ]);
  });

  it('deduplicates overlapping pages and changes a count only once', () => {
    expect(
      reconcileGroupedSoup(
        [
          ...baseline,
          {
            key: 'todo',
            totalCount: 30,
            itemIds: ['b', 'd'],
            nextCursor: 'todo-page-3',
          },
        ],
        [
          { id: 'b', previousGroupKeys: ['todo'], groupKeys: ['done'] },
          { id: 'b', previousGroupKeys: ['todo'], groupKeys: ['done'] },
          { id: 'd', previousGroupKeys: ['todo'], groupKeys: ['done'] },
        ]
      )
    ).toEqual([
      {
        key: 'todo',
        totalCount: 28,
        itemIds: ['a'],
        nextCursor: 'todo-page-2',
      },
      {
        key: 'done',
        totalCount: 12,
        itemIds: ['b', 'd', 'c'],
        nextCursor: 'done-page-2',
      },
    ]);
  });

  it('preserves unknown membership and rows not covered by an evaluation', () => {
    expect(
      reconcileGroupedSoup(baseline, [
        { id: 'a', previousGroupKeys: ['todo', 'done'] },
      ])
    ).toEqual(baseline);
  });

  it('removes proven nonmatches from all known memberships', () => {
    expect(
      reconcileGroupedSoup(baseline, [
        { id: 'a', previousGroupKeys: ['todo', 'done'], groupKeys: [] },
      ])
    ).toEqual([
      {
        key: 'todo',
        totalCount: 29,
        itemIds: ['b'],
        nextCursor: 'todo-page-2',
      },
      { key: 'done', totalCount: 9, itemIds: ['c'], nextCursor: 'done-page-2' },
    ]);
  });

  it('does not count an already-existing but unloaded multi-value membership twice', () => {
    expect(
      reconcileGroupedSoup(baseline, [
        {
          id: 'a',
          previousGroupKeys: ['todo', 'done'],
          groupKeys: ['todo', 'done', 'done'],
        },
      ])
    ).toEqual([
      {
        key: 'todo',
        totalCount: 30,
        itemIds: ['a', 'b'],
        nextCursor: 'todo-page-2',
      },
      {
        key: 'done',
        totalCount: 10,
        itemIds: ['a', 'c'],
        nextCursor: 'done-page-2',
      },
    ]);
  });

  it('does not infer an increase from incomplete previous membership', () => {
    expect(
      reconcileGroupedSoup(baseline, [{ id: 'a', groupKeys: ['done'] }])
    ).toEqual([
      {
        key: 'todo',
        totalCount: 29,
        itemIds: ['b'],
        nextCursor: 'todo-page-2',
      },
      {
        key: 'done',
        totalCount: 10,
        itemIds: ['a', 'c'],
        nextCursor: 'done-page-2',
      },
    ]);
  });

  it('creates a destination bin, including Not Set, without a fabricated cursor', () => {
    expect(
      reconcileGroupedSoup(baseline, [
        { id: 'a', previousGroupKeys: ['todo'], groupKeys: [''] },
      ])
    ).toEqual([
      {
        key: 'todo',
        totalCount: 29,
        itemIds: ['b'],
        nextCursor: 'todo-page-2',
      },
      {
        key: 'done',
        totalCount: 10,
        itemIds: ['c'],
        nextCursor: 'done-page-2',
      },
      { key: '', totalCount: 1, itemIds: ['a'], nextCursor: null },
    ]);
  });

  it('does not claim global candidate coverage from a bounded flat query', () => {
    expect(
      reconcileGroupedSoup(baseline, [
        { id: 'not-loaded', previousGroupKeys: [], groupKeys: ['todo'] },
      ])
    ).toEqual(baseline);
    expect(
      reconcileGroupedSoup([], [{ id: 'not-loaded', groupKeys: ['todo'] }])
    ).toEqual([]);
  });

  it('keeps empty bins and their server cursors when unseen rows remain', () => {
    expect(
      reconcileGroupedSoup(baseline, [
        { id: 'a', groupKeys: [] },
        { id: 'b', groupKeys: [] },
      ])
    ).toEqual([
      { key: 'todo', totalCount: 28, itemIds: [], nextCursor: 'todo-page-2' },
      {
        key: 'done',
        totalCount: 10,
        itemIds: ['c'],
        nextCursor: 'done-page-2',
      },
    ]);
  });

  it('uses evaluated row ordering without a global limit or mutating the baseline', () => {
    const original = structuredClone(baseline);
    expect(
      reconcileGroupedSoup(baseline, [
        { id: 'b', groupKeys: ['todo'] },
        { id: 'a', groupKeys: ['todo'] },
      ])[0].itemIds
    ).toEqual(['b', 'a']);
    expect(baseline).toEqual(original);
  });

  it('never counts fewer than the visible unique rows', () => {
    expect(
      reconcileGroupedSoup(
        [
          {
            key: 'todo',
            totalCount: 0,
            itemIds: ['a', 'b', 'b'],
            nextCursor: null,
          },
        ],
        [{ id: 'a', groupKeys: [] }]
      )
    ).toEqual([
      { key: 'todo', totalCount: 1, itemIds: ['b'], nextCursor: null },
    ]);
  });
});
