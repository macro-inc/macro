import { describe, expect, it } from 'vitest';
import {
  applyMatrix,
  corners,
  degrees,
  dragHandle,
  hitTransform,
  isIdentity,
  isTranslation,
  matrixOf,
  moveBy,
  rotateTo,
  startTransform,
} from './transform';

const box = { x: 100, y: 50, w: 200, h: 100 };
const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe('free transform', () => {
  it('starts as the identity', () => {
    const t = startTransform(box);
    expect(isIdentity(t)).toBe(true);
    const m = matrixOf(t);
    const p = applyMatrix(m, { x: 123, y: 77 });
    close(p.x, 123);
    close(p.y, 77);
  });

  it('moves', () => {
    const t = moveBy(startTransform(box), 10, -5);
    expect(isTranslation(t)).toBe(true);
    expect(isIdentity(t)).toBe(false);
    const m = matrixOf(t);
    close(m[4], 10);
    close(m[5], -5);
  });

  it('scales from the opposite handle, keeping proportions at corners', () => {
    const t = dragHandle(
      startTransform(box),
      'se',
      { x: 500, y: 100 },
      { proportional: true, centered: false }
    );
    // The top left stays; the width doubles and the height follows.
    close(corners(t)[0].x, 100);
    close(corners(t)[0].y, 50);
    close(t.w, 400);
    close(t.h, 200);
    const m = matrixOf(t);
    const far = applyMatrix(m, { x: 300, y: 150 });
    close(far.x, 500);
    close(far.y, 250);
  });

  it('scales one side from an edge, or freely, or about the center', () => {
    const edge = dragHandle(
      startTransform(box),
      'e',
      { x: 350, y: 999 },
      {
        proportional: true,
        centered: false,
      }
    );
    close(edge.w, 250);
    close(edge.h, 100);
    close(corners(edge)[0].x, 100);
    const free = dragHandle(
      startTransform(box),
      'nw',
      { x: 50, y: 40 },
      {
        proportional: false,
        centered: false,
      }
    );
    close(free.w, 250);
    close(free.h, 110);
    close(corners(free)[2].x, 300);
    close(corners(free)[2].y, 150);
    const centered = dragHandle(
      startTransform(box),
      'e',
      { x: 310, y: 0 },
      {
        proportional: false,
        centered: true,
      }
    );
    close(centered.w, 220);
    close(centered.cx, 200);
  });

  it('flips when a handle crosses its anchor', () => {
    const t = dragHandle(
      startTransform(box),
      'e',
      { x: 0, y: 0 },
      {
        proportional: false,
        centered: false,
      }
    );
    expect(t.w).toBeLessThan(0);
    const m = matrixOf(t);
    expect(m[0]).toBeLessThan(0);
  });

  it('rotates around the center, snapping with Shift', () => {
    const t = startTransform(box);
    const turned = rotateTo(
      t,
      0,
      { x: 300, y: 100 },
      { x: 200, y: 200 },
      false
    );
    expect(degrees(turned)).toBe(90);
    // 16.7° snaps to 15°.
    const snapped = rotateTo(
      t,
      0,
      { x: 300, y: 100 },
      { x: 300, y: 130 },
      true
    );
    expect(degrees(snapped)).toBe(15);
    const m = matrixOf(turned);
    const center = applyMatrix(m, { x: 200, y: 100 });
    close(center.x, 200);
    close(center.y, 100);
  });

  it('hits handles, the inside, and the rotation zone', () => {
    const t = startTransform(box);
    expect(hitTransform(t, { x: 101, y: 51 }, 4)).toEqual({
      kind: 'handle',
      handle: 'nw',
    });
    expect(hitTransform(t, { x: 200, y: 100 }, 4)).toEqual({ kind: 'move' });
    expect(hitTransform(t, { x: 90, y: 40 }, 4)).toEqual({ kind: 'rotate' });
    expect(hitTransform(t, { x: 0, y: 0 }, 4)).toBeUndefined();
  });
});
