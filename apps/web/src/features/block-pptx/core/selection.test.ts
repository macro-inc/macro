import type { ShapeOutline } from '@core/pptx-engine/types';
import { describe, expect, it } from 'vitest';
import {
  alignOps,
  boundsOf,
  rectFromPoints,
  reorderOps,
  scaleBox,
  shapesInRect,
  unionBounds,
} from './selection';

function shape(
  id: number,
  x: number,
  y: number,
  w: number,
  h: number,
  rotation = 0
): ShapeOutline {
  return {
    id,
    name: `Shape ${id}`,
    kind: 'shape',
    x,
    y,
    w,
    h,
    rotation,
    flipH: false,
    flipV: false,
    hidden: false,
    textEditable: true,
  };
}

const SLIDE = { w: 960, h: 540 };

describe('selection geometry', () => {
  it('bounds rotated boxes by their corners', () => {
    const b = boundsOf({ x: 0, y: 0, w: 100, h: 100, rotation: 45 });
    expect(b.w).toBeCloseTo(Math.SQRT2 * 100);
    expect(b.x).toBeCloseTo(50 - (Math.SQRT2 * 100) / 2);
  });

  it('unions several boxes', () => {
    expect(
      unionBounds([
        { x: 10, y: 20, w: 30, h: 40, rotation: 0 },
        { x: 100, y: 0, w: 10, h: 10, rotation: 0 },
      ])
    ).toEqual({ x: 10, y: 0, w: 100, h: 60 });
    expect(unionBounds([])).toBeUndefined();
  });

  it('marquee picks only shapes entirely inside', () => {
    const shapes = [shape(1, 10, 10, 50, 50), shape(2, 40, 40, 100, 100)];
    const rect = rectFromPoints({ x: 100, y: 100 }, { x: 0, y: 0 });
    expect(shapesInRect(shapes, rect)).toEqual([1]);
  });

  it('scales boxes with the selection bounds', () => {
    const from = { x: 0, y: 0, w: 100, h: 100 };
    const to = { x: 0, y: 0, w: 200, h: 50 };
    expect(
      scaleBox({ x: 50, y: 50, w: 50, h: 50, rotation: 0 }, from, to)
    ).toEqual({ x: 100, y: 25, w: 100, h: 25, rotation: 0 });
  });
});

describe('align and distribute', () => {
  it('aligns several shapes to their joint bounds', () => {
    const shapes = [shape(1, 10, 10, 50, 50), shape(2, 100, 200, 20, 20)];
    expect(alignOps(7, shapes, 'left', SLIDE)).toEqual([
      { op: 'setTransform', slide: 7, shape: 2, x: 10, y: 200 },
    ]);
    expect(alignOps(7, shapes, 'bottom', SLIDE)).toEqual([
      { op: 'setTransform', slide: 7, shape: 1, x: 10, y: 170 },
    ]);
  });

  it('aligns a single shape to the slide', () => {
    expect(alignOps(1, [shape(1, 0, 0, 100, 40)], 'center', SLIDE)).toEqual([
      { op: 'setTransform', slide: 1, shape: 1, x: 430, y: 0 },
    ]);
  });

  it('distributes so the gaps are equal', () => {
    const shapes = [
      shape(1, 0, 0, 10, 10),
      shape(2, 15, 0, 10, 10),
      shape(3, 90, 0, 10, 10),
    ];
    // Span 100, 30 of shapes: two gaps of 35, so the middle goes to 45.
    expect(alignOps(1, shapes, 'distributeH', SLIDE)).toEqual([
      { op: 'setTransform', slide: 1, shape: 2, x: 45, y: 0 },
    ]);
  });
});

describe('z-order', () => {
  const all = [
    shape(1, 0, 0, 1, 1),
    shape(2, 0, 0, 1, 1),
    shape(3, 0, 0, 1, 1),
  ];
  const picked = [all[2], all[0]];
  it('brings to front bottom-first so the pair keeps its order', () => {
    expect(reorderOps(1, picked, all, 'front').map((o) => o.shape)).toEqual([
      1, 3,
    ]);
  });
  it('sends to back top-first', () => {
    expect(reorderOps(1, picked, all, 'back').map((o) => o.shape)).toEqual([
      3, 1,
    ]);
  });
});
