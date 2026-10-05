import type { LayerRow } from '@core/psd-engine/types';
import { describe, expect, it } from 'vitest';
import {
  dropPlacement,
  dropZone,
  isWithin,
  layerBelow,
  rangeBetween,
  visibleRows,
} from './layer-tree';
import { mergeDownOp, newLayerOp, paintable } from './ops';

function row(
  id: number,
  depth: number,
  parent: number | null,
  extra: Partial<LayerRow> = {}
): LayerRow {
  return {
    id,
    name: `Layer ${id}`,
    kind: 'pixel',
    depth,
    parent,
    visible: true,
    shown: true,
    opacity: 255,
    fillOpacity: 255,
    blend: 'normal',
    clipping: false,
    locks: {
      transparency: false,
      pixels: false,
      position: false,
      artboard: false,
    },
    colorTag: 0,
    background: false,
    hasMask: false,
    maskDisabled: false,
    hasVectorMask: false,
    hasEffects: false,
    open: false,
    children: 0,
    bounds: null,
    ...extra,
  };
}

// Top to bottom: Text, Group (open: A, Inner (closed: B)), Background.
const rows: LayerRow[] = [
  row(1, 0, null, { kind: 'text' }),
  row(2, 0, null, { kind: 'group', open: true, children: 2 }),
  row(3, 1, 2),
  row(4, 1, 2, { kind: 'group', open: false, children: 1 }),
  row(5, 2, 4),
  row(6, 0, null, { background: true }),
];

describe('layer tree', () => {
  it('hides rows in collapsed groups', () => {
    expect(visibleRows(rows).map((r) => r.id)).toEqual([1, 2, 3, 4, 6]);
  });

  it('knows what is inside what', () => {
    expect(isWithin(rows, 5, 2)).toBe(true);
    expect(isWithin(rows, 1, 2)).toBe(false);
  });

  it('splits rows into drop zones', () => {
    expect(dropZone(rows[1], 0.1)).toBe('before');
    expect(dropZone(rows[1], 0.5)).toBe('inside');
    expect(dropZone(rows[0], 0.6)).toBe('after');
  });

  it('turns drops into moves', () => {
    expect(dropPlacement(rows, [1], rows[2], 'before')).toEqual({
      parent: 2,
      position: { type: 'above', id: 3 },
    });
    expect(dropPlacement(rows, [3], rows[0], 'after')).toEqual({
      parent: null,
      position: { type: 'below', id: 1 },
    });
    // Below an open group's row: into the group, on top.
    expect(dropPlacement(rows, [1], rows[1], 'after')).toEqual({
      parent: 2,
      position: { type: 'top' },
    });
    expect(dropPlacement(rows, [1], rows[3], 'inside')).toEqual({
      parent: 4,
      position: { type: 'top' },
    });
    // Not into itself, nor below the Background.
    expect(dropPlacement(rows, [2], rows[3], 'inside')).toBeUndefined();
    expect(dropPlacement(rows, [2], rows[2], 'before')).toBeUndefined();
    expect(dropPlacement(rows, [1], rows[5], 'after')).toBeUndefined();
  });

  it('selects ranges and finds the layer below', () => {
    expect(rangeBetween(rows, 6, 2)).toEqual([2, 3, 4, 5, 6]);
    expect(layerBelow(rows, 3)?.id).toBe(4);
    expect(layerBelow(rows, 4)).toBeUndefined();
    expect(layerBelow(rows, 1)?.id).toBe(2);
  });
});

describe('ops', () => {
  it('adds layers above the active one', () => {
    expect(newLayerOp(rows[2], { type: 'pixel' })).toEqual({
      op: 'newLayer',
      parent: 2,
      position: { type: 'above', id: 3 },
      name: null,
      kind: { type: 'pixel' },
    });
    expect(newLayerOp(undefined, { type: 'group' }, 'G')).toMatchObject({
      parent: null,
      position: { type: 'top' },
      name: 'G',
    });
  });

  it('merges down only onto a layer below', () => {
    expect(mergeDownOp(rows, 3)).toEqual({ op: 'merge', ids: [3] });
    expect(mergeDownOp(rows, 5)).toBeUndefined();
  });

  it('paints pixel layers and masks', () => {
    expect(paintable(rows[2], 'pixels')).toBe(true);
    expect(paintable(rows[0], 'pixels')).toBe(false);
    expect(paintable(rows[2], 'mask')).toBe(false);
    expect(paintable({ ...rows[0], hasMask: true }, 'mask')).toBe(true);
  });
});
