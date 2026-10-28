import { describe, expect, it } from 'vitest';
import {
  quantizeScale,
  TILE,
  tileRect,
  tilesCover,
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

  it('tells whether the tiles of a scale cover a rectangle', () => {
    const side = TILE / 2;
    const present = new Set(['0:0', '1:0']);
    expect(tilesCover({ x: 10, y: 10, w: side, h: 50 }, 2, present)).toBe(true);
    // Edges on the grid need no tile beyond them.
    expect(tilesCover({ x: 0, y: 0, w: 2 * side, h: side }, 2, present)).toBe(
      true
    );
    expect(tilesCover({ x: 0, y: 0, w: side, h: side + 1 }, 2, present)).toBe(
      false
    );
    // Tiles outside the content are never rendered: they count as covering.
    const content = { x: 0, y: 0, w: 2 * side, h: side };
    expect(
      tilesCover({ x: 0, y: 0, w: 2 * side, h: 3 * side }, 2, present, content)
    ).toBe(true);
  });
});
