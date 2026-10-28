import type { LiftPlan } from '@core/fig-engine/types';
import { describe, expect, it } from 'vitest';
import { liftParts, liftTiles, offsetRect, runTiles, tilePatch } from './lift';

// At scale 1 a tile covers 512 page units; the view is 4×2 tiles.
const camera = { x: 0, y: 0, zoom: 1 };
const viewport = { w: 2048, h: 1024 };
const ids = (tiles: { key: { ix: number; iy: number } }[]) =>
  tiles.map((t) => `${t.key.ix},${t.key.iy}`).sort();

const plan = (above: { x: number; y: number; w: number; h: number }[] = []) =>
  ({
    runs: [
      {
        ids: ['1:2'],
        bounds: { x: 100, y: 100, w: 200, h: 200 },
        origin: { x: 100, y: 100 },
        clips: [],
        above,
      },
    ],
  }) satisfies LiftPlan;

describe('lift', () => {
  it('names the parts to render', () => {
    const run = (ids: string[], x: number) => ({
      ids,
      bounds: { x, y: 0, w: 10, h: 10 },
      origin: { x, y: 0 },
      clips: [],
      above: [],
    });
    const two: LiftPlan = { runs: [run(['1:1', '1:2'], 0), run(['1:5'], 40)] };
    expect(liftParts(two)).toEqual({
      page: { skip: ['1:1', '1:2', '1:5'] },
      below: { before: '1:1' },
      runs: [
        { only: ['1:1', '1:2'], anchor: [0, 0] },
        { only: ['1:5'], anchor: [40, 0] },
      ],
      above: [
        { after: '1:2', before: '1:5' },
        { after: '1:5', before: null },
      ],
    });
  });

  it('draws the tiles a run covers where it started and where it is', () => {
    // Moved from tile 0,0 into tile 1,0.
    const tiles = liftTiles(plan(), { x: 400, y: 0 }, camera, viewport, 1);
    expect(ids(tiles)).toEqual(['0,0', '1,0']);
    const home = tiles.find((t) => t.key.ix === 0);
    const now = tiles.find((t) => t.key.ix === 1);
    // Where it started its pixels must go; where it is the page shows below.
    expect(home?.below).toBe(true);
    expect(now?.below).toBe(false);
    expect(now?.above).toEqual([]);
  });

  it('takes what paints above a run out of the page tiles under it', () => {
    const above = [{ x: 600, y: 50, w: 100, h: 100 }];
    const tiles = liftTiles(plan(above), { x: 400, y: 0 }, camera, viewport, 1);
    const now = tiles.find((t) => t.key.ix === 1);
    expect(now?.below).toBe(true);
    expect(now?.above).toEqual([0]);
    // Away from the run, what paints above it needs nothing drawn apart.
    const still = liftTiles(plan(above), { x: 0, y: 0 }, camera, viewport, 1);
    expect(ids(still)).toEqual(['0,0']);
  });

  it('renders the tiles of a run that show at its offset', () => {
    const bounds = { x: 100, y: 100, w: 1200, h: 200 };
    // Moved left by 900: only its right part (from 900 on) is in view.
    expect(
      runTiles(bounds, { x: -900, y: 0 }, camera, viewport, 1).map(
        (k) => `${k.ix},${k.iy}`
      )
    ).toEqual(expect.arrayContaining(['1,0', '2,0']));
    expect(
      runTiles(bounds, { x: -900, y: 0 }, camera, viewport, 1).some(
        (k) => k.ix === 0
      )
    ).toBe(false);
  });

  it('renders only the part of a tile that rectangles cover', () => {
    // Scale 2: tile 0,0 covers page 0..256.
    const key = { scale: 2, ix: 0, iy: 0 };
    expect(tilePatch(key, [{ x: 10, y: 20, w: 30, h: 5 }])).toEqual({
      x: 19,
      y: 39,
      w: 62,
      h: 12,
    });
    // Two rectangles: what covers both; clamped to the tile.
    expect(
      tilePatch(key, [
        { x: 10, y: 20, w: 30, h: 5 },
        { x: 200, y: -50, w: 100, h: 100 },
      ])
    ).toEqual({ x: 19, y: 0, w: 493, h: 101 });
    expect(tilePatch(key, [{ x: 300, y: 0, w: 10, h: 10 }])).toBeUndefined();
  });

  it('offsets rectangles', () => {
    expect(offsetRect({ x: 1, y: 2, w: 3, h: 4 }, { x: 10, y: -2 })).toEqual({
      x: 11,
      y: 0,
      w: 3,
      h: 4,
    });
  });
});
