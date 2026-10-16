import { describe, expect, it } from 'vitest';
import {
  canvasToLevel,
  cellSources,
  levelFor,
  levelSize,
  overviewLevel,
  sourceRegion,
  type TileKey,
  tileId,
  tileLevelRect,
  tilesFor,
  tileTouches,
} from './tiles';

const doc = { width: 3000, height: 2000 };

describe('levels', () => {
  it('picks the sharpest level that still downscales', () => {
    expect(levelFor(4)).toBe(0);
    expect(levelFor(1)).toBe(0);
    expect(levelFor(0.75)).toBe(0);
    expect(levelFor(0.5)).toBe(1);
    expect(levelFor(0.49)).toBe(1);
    expect(levelFor(0.25)).toBe(2);
    expect(levelFor(0.2)).toBe(2);
    expect(levelFor(0)).toBe(0);
  });

  it('rounds canvas sizes outward at each level', () => {
    expect(levelSize(3000, 0)).toBe(3000);
    expect(levelSize(3001, 1)).toBe(1501);
    expect(levelSize(2000, 3)).toBe(250);
  });

  it('fits the overview in its side', () => {
    expect(overviewLevel(doc, 2048)).toBe(1);
    expect(overviewLevel({ width: 500, height: 400 }, 2048)).toBe(0);
    expect(overviewLevel({ width: 30000, height: 30000 }, 2048)).toBe(4);
  });
});

describe('tiles', () => {
  it('clips tiles to the canvas at their level', () => {
    expect(tileLevelRect({ level: 0, ix: 5, iy: 3 }, doc)).toEqual({
      x: 2560,
      y: 1536,
      w: 440,
      h: 464,
    });
    expect(tileLevelRect({ level: 2, ix: 1, iy: 0 }, doc)).toEqual({
      x: 512,
      y: 0,
      w: 238,
      h: 500,
    });
    // Outside the canvas: empty.
    expect(tileLevelRect({ level: 0, ix: 6, iy: 0 }, doc).w).toBe(0);
  });

  it('lists the tiles of a view, nearest its center first', () => {
    const keys = tilesFor({ x: 600, y: 600, w: 800, h: 300 }, 0, doc);
    expect(keys.map(tileId).sort()).toEqual(['0:1:1', '0:2:1'].sort());
    const margin = tilesFor({ x: 0, y: 0, w: 100, h: 100 }, 0, doc, 1);
    // Never outside the canvas.
    expect(margin.map(tileId).sort()).toEqual(
      ['0:0:0', '0:1:0', '0:0:1', '0:1:1'].sort()
    );
  });

  it('maps canvas rectangles to level pixels outward', () => {
    expect(canvasToLevel({ x: 3, y: 5, w: 10, h: 2 }, 2)).toEqual({
      x: 0,
      y: 1,
      w: 4,
      h: 1,
    });
    expect(
      tileTouches({ level: 1, ix: 1, iy: 0 }, { x: 1024, y: 0, w: 1, h: 1 })
    ).toBe(true);
    expect(
      tileTouches({ level: 1, ix: 1, iy: 0 }, { x: 1023, y: 0, w: 1, h: 1 })
    ).toBe(false);
  });
});

describe('cell sources', () => {
  const have = (...ids: string[]) => {
    const set = new Set(ids);
    return (k: TileKey) => set.has(tileId(k));
  };

  it('prefers the cell itself', () => {
    expect(
      cellSources({ level: 1, ix: 0, iy: 0 }, doc, have('1:0:0', '2:0:0'))
    ).toEqual([{ level: 1, ix: 0, iy: 0 }]);
  });

  it('uses sharper children only when they cover the cell', () => {
    const cell = { level: 1, ix: 1, iy: 1 };
    const children = ['0:2:2', '0:3:2', '0:2:3', '0:3:3'];
    expect(cellSources(cell, doc, have(...children)).map(tileId)).toEqual(
      children
    );
    // One missing: the coarser parent instead (never mixed, which would
    // draw transparent areas twice).
    expect(
      cellSources(cell, doc, have('0:2:2', '0:3:2', '0:2:3', '3:0:0')).map(
        tileId
      )
    ).toEqual(['3:0:0']);
  });

  it('skips children outside the canvas', () => {
    // A 600 × 500 canvas has one row of level-0 tiles: the cell's lower
    // children are outside it.
    const small = { width: 600, height: 500 };
    expect(
      cellSources(
        { level: 1, ix: 0, iy: 0 },
        small,
        have('0:0:0', '0:1:0')
      ).map(tileId)
    ).toEqual(['0:0:0', '0:1:0']);
  });

  it('maps a coarse source to the cell it stands in for', () => {
    const region = sourceRegion(
      { level: 2, ix: 0, iy: 0 },
      { level: 0, ix: 1, iy: 0 },
      doc
    );
    expect(region).toEqual({
      from: { x: 128, y: 0, w: 128, h: 128 },
      to: { x: 512, y: 0, w: 512, h: 512 },
    });
  });
});
