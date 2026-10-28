import type { ShapeOutline } from '@core/pptx-engine/types';
import { describe, expect, it } from 'vitest';
import {
  applyAffine,
  type Box,
  boxContains,
  handlePosition,
  hitTest,
  invertAffine,
  resizeBox,
  rotationToward,
} from './geometry';

const shape = (id: number, box: Partial<ShapeOutline>): ShapeOutline => ({
  id,
  name: `s${id}`,
  kind: 'shape',
  x: 0,
  y: 0,
  w: 10,
  h: 10,
  rotation: 0,
  flipH: false,
  flipV: false,
  hidden: false,
  textEditable: true,
  ...box,
});

const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe('hit testing', () => {
  it('returns the topmost shape and respects rotation', () => {
    const shapes = [
      shape(1, { x: 0, y: 0, w: 100, h: 100 }),
      shape(2, { x: 40, y: 40, w: 40, h: 10 }),
    ];
    expect(hitTest(shapes, { x: 50, y: 45 })?.id).toBe(2);
    expect(hitTest(shapes, { x: 10, y: 10 })?.id).toBe(1);
    expect(hitTest(shapes, { x: 150, y: 10 })).toBeUndefined();
    // Rotated 90°: the 40x10 bar becomes 10x40 around its center (60, 45).
    const rotated = [shape(3, { x: 40, y: 40, w: 40, h: 10, rotation: 90 })];
    expect(hitTest(rotated, { x: 60, y: 30 })?.id).toBe(3);
    expect(hitTest(rotated, { x: 45, y: 45 })).toBeUndefined();
  });

  it('gives thin shapes some slop and skips hidden ones', () => {
    const shapes = [
      shape(1, { x: 0, y: 50, w: 100, h: 0, kind: 'connector' }),
      shape(2, { hidden: true, w: 100, h: 100 }),
    ];
    expect(hitTest(shapes, { x: 50, y: 52 })?.id).toBe(1);
    expect(hitTest(shapes, { x: 5, y: 5 })).toBeUndefined();
  });
});

describe('resizing', () => {
  const box: Box = { x: 10, y: 10, w: 100, h: 50, rotation: 0 };

  it('keeps the opposite corner fixed', () => {
    const r = resizeBox(box, 'se', { x: 210, y: 110 });
    expect(r).toEqual({ x: 10, y: 10, w: 200, h: 100, rotation: 0 });
    const l = resizeBox(box, 'nw', { x: 0, y: 0 });
    expect(l).toEqual({ x: 0, y: 0, w: 110, h: 60, rotation: 0 });
  });

  it('moves only one axis for edge handles', () => {
    const r = resizeBox(box, 'e', { x: 160, y: 500 });
    expect(r).toEqual({ x: 10, y: 10, w: 150, h: 50, rotation: 0 });
  });

  it('keeps the aspect ratio when asked', () => {
    const r = resizeBox(box, 'se', { x: 310, y: 20 }, true);
    close(r.w / r.h, 2);
    close(r.w, 300);
  });

  it('keeps the anchor fixed for rotated boxes', () => {
    const rotated: Box = { ...box, rotation: 30 };
    const anchorBefore = handlePosition(rotated, 'nw');
    // The new bottom-right corner, 150 × 80 away from the anchor along the rotated axes.
    const angle = (30 * Math.PI) / 180;
    const target = {
      x: anchorBefore.x + 150 * Math.cos(angle) - 80 * Math.sin(angle),
      y: anchorBefore.y + 150 * Math.sin(angle) + 80 * Math.cos(angle),
    };
    const r = resizeBox(rotated, 'se', target);
    close(r.w, 150);
    close(r.h, 80);
    const anchorAfter = handlePosition(r, 'nw');
    close(anchorAfter.x, anchorBefore.x);
    close(anchorAfter.y, anchorBefore.y);
  });
});

describe('rotation', () => {
  it('measures clockwise from straight up and snaps', () => {
    const b: Box = { x: 0, y: 0, w: 100, h: 100, rotation: 0 };
    expect(rotationToward(b, { x: 50, y: -10 })).toBe(0);
    expect(rotationToward(b, { x: 150, y: 50 })).toBe(90);
    expect(rotationToward(b, { x: 50, y: 200 })).toBe(180);
    expect(rotationToward(b, { x: -100, y: 50 })).toBe(270);
    expect(rotationToward(b, { x: 150, y: 46 }, 0)).toBeCloseTo(87.7, 1);
  });

  it('inverts affine transforms', () => {
    const t: [number, number, number, number, number, number] = [
      0, 1, -1, 0, 10, 20,
    ];
    const inv = invertAffine(t);
    expect(inv).not.toBeNull();
    const p = applyAffine(t, { x: 3, y: 4 });
    const back = applyAffine(inv!, p);
    close(back.x, 3);
    close(back.y, 4);
    expect(
      boxContains({ x: 0, y: 0, w: 10, h: 10, rotation: 45 }, { x: 5, y: -1 })
    ).toBe(true);
  });
});
