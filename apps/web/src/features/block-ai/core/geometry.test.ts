import { describe, expect, it } from 'vitest';
import {
  apply,
  constrainAngle,
  dragAngle,
  geometricRect,
  handleAt,
  invert,
  multiply,
  rectToRect,
  resizeBox,
  resizeMatrix,
  rotateAbout,
  rotatesAt,
  rotationOf,
  scaleAbout,
  shapeRect,
  spanRect,
  toEdges,
  toRect,
  translate,
  unionOf,
} from './geometry';

const close = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
};

describe('rectangles', () => {
  it('convert between edges and sizes', () => {
    const edges = { x0: 10, y0: 20, x1: 40, y1: 60 };
    expect(toRect(edges)).toEqual({ x: 10, y: 20, w: 30, h: 40 });
    expect(toEdges(toRect(edges))).toEqual(edges);
  });

  it('span corners in any order and union', () => {
    expect(spanRect({ x: 5, y: 9 }, { x: 1, y: 2 })).toEqual({
      x: 1,
      y: 2,
      w: 4,
      h: 7,
    });
    expect(
      unionOf([
        { x: 0, y: 0, w: 10, h: 10 },
        { x: 20, y: -5, w: 5, h: 5 },
      ])
    ).toEqual({ x: 0, y: -5, w: 25, h: 15 });
    expect(unionOf([])).toBeUndefined();
  });
});

describe('matrices', () => {
  it('compose in order and invert', () => {
    const m = multiply(scaleAbout(2, 2, { x: 0, y: 0 }), translate(10, 0));
    close(apply(m, { x: 1, y: 1 }), { x: 12, y: 2 });
    const inv = invert(m);
    expect(inv).toBeDefined();
    if (inv) close(apply(inv, { x: 12, y: 2 }), { x: 1, y: 1 });
    expect(invert([0, 0, 0, 1, 0, 0])).toBeUndefined();
  });

  it('rotate about a point and report the angle', () => {
    const m = rotateAbout(Math.PI / 2, { x: 10, y: 10 });
    close(apply(m, { x: 20, y: 10 }), { x: 10, y: 20 });
    // Clockwise on screen is a negative Illustrator angle.
    expect(rotationOf(m)).toBe(-90);
    expect(rotationOf([1, 0, 0, 1, 5, 5])).toBe(0);
  });

  it('map one rectangle onto another', () => {
    const m = rectToRect(
      { x: 0, y: 0, w: 10, h: 20 },
      { x: 5, y: 5, w: 20, h: 10 }
    );
    close(apply(m, { x: 0, y: 0 }), { x: 5, y: 5 });
    close(apply(m, { x: 10, y: 20 }), { x: 25, y: 15 });
  });
});

describe('the selection box', () => {
  const box = { x: 100, y: 100, w: 200, h: 100 };

  it('finds corner handles first and edge handles on big boxes', () => {
    expect(handleAt(box, { x: 102, y: 99 }, 6)).toBe('nw');
    expect(handleAt(box, { x: 300, y: 200 }, 6)).toBe('se');
    expect(handleAt(box, { x: 200, y: 101 }, 6)).toBe('n');
    expect(handleAt(box, { x: 200, y: 150 }, 6)).toBeUndefined();
    // A small box offers its corners only.
    expect(
      handleAt({ x: 0, y: 0, w: 16, h: 16 }, { x: 8, y: 0 }, 6)
    ).toBeUndefined();
  });

  it('rotates just outside a corner', () => {
    expect(rotatesAt(box, { x: 88, y: 88 }, 6, 18)).toBe(true);
    expect(rotatesAt(box, { x: 101, y: 101 }, 6, 18)).toBe(false);
    expect(rotatesAt(box, { x: 50, y: 50 }, 6, 18)).toBe(false);
  });

  it('resizes from a corner, keeping the ratio or the center', () => {
    const free = { keepRatio: false, fromCenter: false };
    expect(resizeBox(box, 'se', { x: 400, y: 300 }, free)).toEqual({
      x: 100,
      y: 100,
      w: 300,
      h: 200,
    });
    expect(
      resizeBox(box, 'se', { x: 500, y: 250 }, { ...free, keepRatio: true })
    ).toEqual({ x: 100, y: 100, w: 400, h: 200 });
    expect(
      resizeBox(box, 'e', { x: 350, y: 0 }, { ...free, fromCenter: true })
    ).toEqual({ x: 50, y: 100, w: 300, h: 100 });
    expect(resizeBox(box, 'n', { x: 0, y: 50 }, free)).toEqual({
      x: 100,
      y: 50,
      w: 200,
      h: 150,
    });
  });

  it('flips when a handle crosses the opposite side', () => {
    const m = resizeMatrix(
      box,
      'e',
      { x: 0, y: 0 },
      {
        keepRatio: false,
        fromCenter: false,
      }
    );
    // The right edge went 100 past the left one: mirrored, 100 wide.
    close(apply(m, { x: 300, y: 150 }), { x: 0, y: 150 });
    close(apply(m, { x: 100, y: 150 }), { x: 100, y: 150 });
  });

  it('turns by the dragged angle, snapping to 45° with ⇧', () => {
    const origin = { x: 0, y: 0 };
    expect(
      dragAngle(origin, { x: 10, y: 0 }, { x: 0, y: 10 }, false)
    ).toBeCloseTo(Math.PI / 2);
    expect(dragAngle(origin, { x: 10, y: 0 }, { x: 10, y: 3 }, true)).toBe(0);
  });
});

describe('drawing', () => {
  it('constrains lines to 45° steps', () => {
    close(constrainAngle({ x: 0, y: 0 }, { x: 10, y: 1 }, true), {
      x: Math.hypot(10, 1),
      y: 0,
    });
    expect(constrainAngle({ x: 0, y: 0 }, { x: 3, y: 4 }, false)).toEqual({
      x: 3,
      y: 4,
    });
  });

  it('draws squares and from the center', () => {
    expect(
      shapeRect(
        { x: 10, y: 10 },
        { x: 20, y: 40 },
        { square: true, fromCenter: false }
      )
    ).toEqual({ x: 10, y: 10, w: 30, h: 30 });
    expect(
      shapeRect(
        { x: 10, y: 10 },
        { x: 20, y: 15 },
        { square: false, fromCenter: true }
      )
    ).toEqual({ x: 0, y: 5, w: 20, h: 10 });
  });
});

describe('geometric bounds', () => {
  it('leave strokes out when the engine measured them', () => {
    const drawn = { x0: 9, y0: 9, x1: 111, y1: 61 };
    const outline = { x0: 10, y0: 10, x1: 110, y1: 60 };
    expect(geometricRect({ shapeBounds: outline, bounds: drawn })).toEqual({
      x: 10,
      y: 10,
      w: 100,
      h: 50,
    });
    expect(geometricRect({ shapeBounds: null, bounds: drawn })).toEqual({
      x: 9,
      y: 9,
      w: 102,
      h: 52,
    });
    expect(geometricRect({ shapeBounds: null, bounds: null })).toBeUndefined();
  });
});
