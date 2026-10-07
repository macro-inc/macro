import { describe, expect, it } from 'vitest';
import { rowClick, type TreeRow, treeMove } from './layer-tree';

const order = ['a', 'b', 'c', 'd'];

describe('layer row clicks', () => {
  it('selects one row, a Shift range, or toggles with ⌘', () => {
    const none = { shift: false, toggle: false };
    expect(rowClick(order, 'b', 'a', none)).toEqual({
      kind: 'select',
      ids: ['b'],
    });
    expect(rowClick(order, 'd', 'b', { shift: true, toggle: false })).toEqual({
      kind: 'select',
      ids: ['b', 'c', 'd'],
    });
    expect(rowClick(order, 'a', 'c', { shift: true, toggle: false })).toEqual({
      kind: 'select',
      ids: ['a', 'b', 'c'],
    });
    expect(rowClick(order, 'c', 'a', { shift: false, toggle: true })).toEqual({
      kind: 'toggle',
      id: 'c',
    });
    // Without an anchor (or one no longer shown), Shift selects the row.
    expect(rowClick(order, 'c', 'x', { shift: true, toggle: false })).toEqual({
      kind: 'select',
      ids: ['c'],
    });
  });
});

describe('arrow keys in the layer tree', () => {
  const rows: TreeRow[] = [
    { id: 'frame', parent: undefined, hasChildren: true, expanded: true },
    { id: 'child', parent: 'frame', hasChildren: false, expanded: false },
    { id: 'group', parent: undefined, hasChildren: true, expanded: false },
  ];

  it('moves up and down the rows shown', () => {
    expect(treeMove(rows, 'frame', 'ArrowDown')).toEqual({
      kind: 'select',
      id: 'child',
    });
    expect(treeMove(rows, 'group', 'ArrowUp')).toEqual({
      kind: 'select',
      id: 'child',
    });
    expect(treeMove(rows, 'frame', 'ArrowUp')).toBeUndefined();
    expect(treeMove(rows, 'group', 'ArrowDown')).toBeUndefined();
    expect(treeMove(rows, undefined, 'ArrowDown')).toEqual({
      kind: 'select',
      id: 'frame',
    });
  });

  it('expands, enters, collapses, and goes to the parent', () => {
    expect(treeMove(rows, 'group', 'ArrowRight')).toEqual({
      kind: 'expand',
      id: 'group',
    });
    expect(treeMove(rows, 'frame', 'ArrowRight')).toEqual({
      kind: 'select',
      id: 'child',
    });
    expect(treeMove(rows, 'frame', 'ArrowLeft')).toEqual({
      kind: 'collapse',
      id: 'frame',
    });
    expect(treeMove(rows, 'child', 'ArrowLeft')).toEqual({
      kind: 'select',
      id: 'frame',
    });
    expect(treeMove(rows, 'child', 'ArrowRight')).toBeUndefined();
  });
});
