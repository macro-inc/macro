import { describe, expect, it } from 'vitest';
import { normalizeCurve } from './adjustments';
import { brushFor, DEFAULT_BRUSH, pressureOf } from './brush';
import { BLACK } from './color';
import { ellipsePath, rectanglePath, shapeLayer } from './shapes';

describe('brushes', () => {
  it('makes each painting tool’s brush', () => {
    const soft = { ...DEFAULT_BRUSH, hardness: 0.2, flow: 0.5 };
    expect(brushFor('brush', soft, BLACK)).toMatchObject({
      hardness: 0.2,
      flow: 0.5,
      mode: 'paint',
      pencil: false,
    });
    expect(brushFor('pencil', soft, BLACK)).toMatchObject({
      hardness: 1,
      flow: 1,
      pencil: true,
    });
    expect(brushFor('eraser', soft, BLACK).mode).toBe('erase');
    expect(brushFor('brush', { ...soft, size: 9000 }, BLACK).size).toBe(5000);
  });

  it('reads pen pressure only from pens', () => {
    expect(pressureOf({ pointerType: 'mouse', pressure: 0.5 })).toBe(1);
    expect(pressureOf({ pointerType: 'pen', pressure: 0.3 })).toBe(0.3);
    expect(pressureOf({ pointerType: 'pen', pressure: 0 })).toBe(1);
  });
});

describe('shapes', () => {
  it('outlines rectangles and ellipses', () => {
    const rect = rectanglePath({ x: 10, y: 20, w: 30, h: 40 });
    expect(rect.subpaths[0].knots.map((k) => k.anchor)).toEqual([
      [10, 20],
      [40, 20],
      [40, 60],
      [10, 60],
    ]);
    const ellipse = ellipsePath({ x: 0, y: 0, w: 100, h: 50 });
    expect(ellipse.subpaths[0].knots.map((k) => k.anchor)).toEqual([
      [50, 0],
      [100, 25],
      [50, 50],
      [0, 25],
    ]);
    expect(ellipse.subpaths[0].closed).toBe(true);
    const layer = shapeLayer('rectangle', { x: 0, y: 0, w: 1, h: 1 }, BLACK);
    expect(layer).toMatchObject({ type: 'fill', fill: { type: 'solid' } });
  });
});

describe('curves', () => {
  it('sorts points and keeps one per input', () => {
    expect(
      normalizeCurve([
        [255, 255],
        [128.4, 140],
        [0, 0],
        [128, 100],
      ])
    ).toEqual([
      [0, 0],
      [128, 100],
      [255, 255],
    ]);
    expect(normalizeCurve([])).toEqual([
      [0, 0],
      [255, 255],
    ]);
  });
});
