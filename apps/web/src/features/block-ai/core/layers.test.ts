import { describe, expect, it } from 'vitest';
import {
  ancestorsOf,
  arrangeMoves,
  bottomFirst,
  dropMove,
  type LayerRow,
  layerOf,
  outermost,
  rangeIds,
  selectableIds,
  visibleRows,
} from './layers';

const row = (
  id: number,
  parent: number | null,
  depth: number,
  kind: string,
  children = 0,
  extra: Partial<LayerRow> = {}
): LayerRow => ({
  id,
  parent,
  depth,
  kind,
  name: `n${id}`,
  hidden: false,
  locked: false,
  children,
  ...extra,
});

// Layer 1 (top) holds, top to bottom: rectangle 10, group 20 (paths 21,
// 22), text 30. Layer 2 holds ellipse 40.
const rows: LayerRow[] = [
  row(1, null, 0, 'layer', 3),
  row(10, 1, 1, 'path'),
  row(20, 1, 1, 'group', 2),
  row(21, 20, 2, 'path'),
  row(22, 20, 2, 'path'),
  row(30, 1, 1, 'text'),
  row(2, null, 0, 'layer', 1),
  row(40, 2, 1, 'path'),
];
const byId = (id: number) => rows.find((r) => r.id === id) as LayerRow;

describe('the tree', () => {
  it('shows rows under expanded containers only', () => {
    expect(visibleRows(rows, new Set([1, 2])).map((r) => r.id)).toEqual([
      1, 10, 20, 30, 2, 40,
    ]);
    expect(visibleRows(rows, new Set([2])).map((r) => r.id)).toEqual([
      1, 2, 40,
    ]);
    expect(visibleRows(rows, new Set([1, 2, 20]))).toHaveLength(rows.length);
  });

  it('finds ancestors, layers, and outermost nodes', () => {
    expect(ancestorsOf(rows, 21)).toEqual([1, 20]);
    expect(layerOf(rows, 21)).toBe(1);
    expect(layerOf(rows, 2)).toBe(2);
    expect(outermost(rows, [21, 20, 10])).toEqual([20, 10]);
    expect(bottomFirst(rows, [10, 30, 20])).toEqual([30, 20, 10]);
  });

  it('selects ranges in the order shown', () => {
    const shown = [1, 10, 20, 30];
    expect(rangeIds(shown, 10, 30)).toEqual([10, 20, 30]);
    expect(rangeIds(shown, 30, 10)).toEqual([10, 20, 30]);
    expect(rangeIds(shown, 99, 10)).toEqual([10]);
  });

  it('selects what is in shown, unlocked layers', () => {
    expect(selectableIds(rows)).toEqual([10, 20, 30, 40]);
    const locked = rows.map((r) =>
      r.id === 2
        ? { ...r, locked: true }
        : r.id === 20
          ? { ...r, hidden: true }
          : r
    );
    expect(selectableIds(locked)).toEqual([10, 30]);
  });
});

describe('dropping rows', () => {
  it('puts objects beside a row, into a group, or on top of a layer', () => {
    expect(dropMove(rows, [10], byId(30), 'below')).toEqual({
      ids: [10],
      parent: 1,
      position: { type: 'below', id: 30 },
    });
    expect(dropMove(rows, [10], byId(20), 'inside')).toEqual({
      ids: [10],
      parent: 20,
      position: { type: 'top' },
    });
    expect(dropMove(rows, [10, 30], byId(2), 'above')).toEqual({
      ids: [30, 10],
      parent: 2,
      position: { type: 'top' },
    });
  });

  it('reorders layers among layers', () => {
    expect(dropMove(rows, [2], byId(1), 'above')).toEqual({
      ids: [2],
      parent: null,
      position: { type: 'above', id: 1 },
    });
    expect(dropMove(rows, [1], byId(2), 'below')).toEqual({
      ids: [1],
      parent: null,
      position: { type: 'below', id: 2 },
    });
  });

  it('refuses drops into themselves and mixed drags', () => {
    expect(dropMove(rows, [20], byId(21), 'above')).toBeUndefined();
    expect(dropMove(rows, [1], byId(10), 'inside')).toBeUndefined();
    expect(dropMove(rows, [2, 10], byId(30), 'above')).toBeUndefined();
  });
});

describe('arranging', () => {
  it('steps each object past the next one', () => {
    expect(arrangeMoves(rows, [30], 'forward')).toEqual([
      { ids: [30], parent: 1, position: { type: 'above', id: 20 } },
    ]);
    // A block moves up together.
    expect(arrangeMoves(rows, [30, 20], 'forward')).toEqual([
      { ids: [20], parent: 1, position: { type: 'above', id: 10 } },
      { ids: [30], parent: 1, position: { type: 'above', id: 10 } },
    ]);
    expect(arrangeMoves(rows, [10], 'forward')).toEqual([]);
    expect(arrangeMoves(rows, [10], 'backward')).toEqual([
      { ids: [10], parent: 1, position: { type: 'below', id: 20 } },
    ]);
  });

  it('sends to the front or back of each stack, keeping order', () => {
    expect(arrangeMoves(rows, [20, 30], 'front')).toEqual([
      { ids: [30, 20], parent: 1, position: { type: 'top' } },
    ]);
    expect(arrangeMoves(rows, [10, 40], 'back')).toEqual([
      { ids: [10], parent: 1, position: { type: 'bottom' } },
      { ids: [40], parent: 2, position: { type: 'bottom' } },
    ]);
  });
});
