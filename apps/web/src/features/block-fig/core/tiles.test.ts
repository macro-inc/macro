import { describe, expect, it } from 'vitest';
import {
  createCoverage,
  quantizeScale,
  TILE,
  tileRect,
  tilesFor,
  tileTouches,
} from './tiles';

describe('tiles', () => {
  it('quantizes scales to four significant digits', () => {
    expect(quantizeScale(1)).toBe(1);
    expect(quantizeScale(2.000049)).toBeCloseTo(2);
    expect(quantizeScale(0.123456)).toBeCloseTo(0.1235);
  });

  it('places tiles on a grid of TILE device pixels', () => {
    expect(tileRect({ scale: 2, ix: 1, iy: -1 })).toEqual({
      x: TILE / 2,
      y: -TILE / 2,
      w: TILE / 2,
      h: TILE / 2,
    });
  });

  it('covers the viewport, nearest the center first', () => {
    const camera = { x: 0, y: 0, zoom: 1 };
    const keys = tilesFor(camera, { w: 1024, h: 1024 }, 1);
    expect(keys).toHaveLength(9);
    // The viewport center (512, 512) is a corner shared by four tiles.
    const first = keys
      .slice(0, 4)
      .map((k) => `${k.ix},${k.iy}`)
      .sort();
    expect(first).toEqual(['0,0', '0,1', '1,0', '1,1']);
  });

  it('adds a margin of tiles for prefetching', () => {
    const camera = { x: 0, y: 0, zoom: 1 };
    expect(tilesFor(camera, { w: 100, h: 100 }, 1, 1)).toHaveLength(9);
  });

  it('refuses absurd tile counts', () => {
    const camera = { x: 0, y: 0, zoom: 0.0001 };
    expect(tilesFor(camera, { w: 2000, h: 2000 }, 512)).toHaveLength(0);
  });

  it('tests tiles against content bounds', () => {
    const key = { scale: 1, ix: 0, iy: 0 };
    expect(tileTouches(key, { x: 500, y: 500, w: 100, h: 100 })).toBe(true);
    expect(tileTouches(key, { x: 600, y: 0, w: 100, h: 100 })).toBe(false);
  });

  it('tells what opaque drawing already covers', () => {
    const coverage = createCoverage(256, 256);
    expect(coverage.covers(0, 0, 64, 64)).toBe(false);
    // Only cells lying wholly inside a rectangle count as covered.
    coverage.add(10, 0, 118, 256);
    expect(coverage.covers(32, 0, 96, 256)).toBe(true);
    expect(coverage.covers(16, 0, 64, 64)).toBe(false);
    coverage.add(0, 0, 32, 256);
    expect(coverage.covers(0, 0, 128, 256)).toBe(true);
    expect(coverage.covers(0, 0, 129, 10)).toBe(false);
    // Outside the content nothing is drawn, so it counts as covered.
    coverage.addOutside(-50, -50, 200, 100);
    expect(coverage.covers(0, 64, 256, 192)).toBe(true);
    expect(coverage.covers(0, 0, 256, 64)).toBe(false);
  });
});
