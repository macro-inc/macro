import { describe, expect, it } from 'vitest';
import {
  addLassoPoint,
  closesPolygon,
  marqueeRect,
  selectModeFor,
} from './selection-math';

describe('selection math', () => {
  it('maps modifiers to modes', () => {
    expect(selectModeFor({ shift: false, alt: false })).toBe('replace');
    expect(selectModeFor({ shift: true, alt: false })).toBe('add');
    expect(selectModeFor({ shift: false, alt: true })).toBe('subtract');
    expect(selectModeFor({ shift: true, alt: true })).toBe('intersect');
  });

  it('draws the marquee in any direction, snapped to pixels', () => {
    expect(marqueeRect({ x: 10.4, y: 20.6 }, { x: 4.2, y: 30.1 })).toEqual({
      x: 4,
      y: 21,
      w: 6,
      h: 9,
    });
  });

  it('keeps a square and draws from the center', () => {
    expect(
      marqueeRect({ x: 0, y: 0 }, { x: 10, y: -4 }, { square: true })
    ).toEqual({ x: 0, y: -10, w: 10, h: 10 });
    expect(
      marqueeRect({ x: 50, y: 50 }, { x: 60, y: 55 }, { centered: true })
    ).toEqual({ x: 40, y: 45, w: 20, h: 10 });
  });

  it('thins lasso points and closes polygons near the start', () => {
    let points = addLassoPoint([], { x: 0, y: 0 });
    points = addLassoPoint(points, { x: 0.2, y: 0.1 });
    expect(points).toHaveLength(1);
    points = addLassoPoint(points, { x: 5, y: 0 });
    points = addLassoPoint(points, { x: 5, y: 5 });
    expect(closesPolygon(points, { x: 1, y: 1 }, 2)).toBe(true);
    expect(closesPolygon(points, { x: 3, y: 3 }, 2)).toBe(false);
    expect(closesPolygon(points.slice(0, 2), { x: 0, y: 0 }, 2)).toBe(false);
  });
});
