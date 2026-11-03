import type { PaneId, PaneLayout } from '@app/lib/split-router';
import { describe, expect, it } from 'vitest';
import { fitsNewColumn, fitsSplit, solveTiles } from '../split-geometry';

const [a, b, c] = ['a', 'b', 'c'] as PaneId[];

const leaf = (pane: PaneId): PaneLayout => ({ type: 'pane', pane });

// a | (b over c)
const stackedBeside = (shares: number[] = [0.5, 0.5]): PaneLayout => ({
  type: 'split',
  axis: 'row',
  shares,
  children: [
    leaf(a),
    {
      type: 'split',
      axis: 'column',
      shares: [0.5, 0.5],
      children: [leaf(b), leaf(c)],
    },
  ],
});

describe('solveTiles', () => {
  it('tiles stacked panes beside another with gutters between them', () => {
    const tiles = solveTiles(stackedBeside(), {
      width: 1000,
      height: 800,
      gutter: 6,
    });

    expect(tiles.panes.get(a)).toEqual({
      left: 0,
      top: 0,
      width: 497,
      height: 800,
    });
    expect(tiles.panes.get(b)).toEqual({
      left: 503,
      top: 0,
      width: 497,
      height: 397,
    });
    expect(tiles.panes.get(c)).toEqual({
      left: 503,
      top: 403,
      width: 497,
      height: 397,
    });
    expect(
      tiles.splits.map(({ path, axis, gutters }) => ({ path, axis, gutters }))
    ).toEqual([
      { path: [], axis: 'row', gutters: [497] },
      { path: [1], axis: 'column', gutters: [397] },
    ]);
  });

  it('keeps a stack at its minimum width when its share is smaller', () => {
    const tiles = solveTiles(stackedBeside([0.8, 0.2]), {
      width: 900,
      height: 800,
      gutter: 6,
    });

    expect(tiles.panes.get(a)?.width).toBe(494);
    expect(tiles.panes.get(b)?.width).toBe(400);
  });
});

describe('room for another split', () => {
  it('fits a new column only while every column keeps its minimum width', () => {
    const area = { height: 800, gutter: 6 };

    expect(fitsNewColumn(stackedBeside(), { ...area, width: 1212 })).toBe(true);
    expect(fitsNewColumn(stackedBeside(), { ...area, width: 1211 })).toBe(
      false
    );
  });

  it('checks a split along its own axis', () => {
    const area = { width: 400, gutter: 6 };

    expect(fitsSplit(leaf(a), { ...area, height: 486 }, a, 'below')).toBe(true);
    expect(fitsSplit(leaf(a), { ...area, height: 485 }, a, 'below')).toBe(
      false
    );
    // Splitting b side by side widens the stack it sits in.
    expect(
      fitsSplit(
        stackedBeside(),
        { width: 1212, height: 400, gutter: 6 },
        b,
        'right'
      )
    ).toBe(true);
    expect(
      fitsSplit(
        stackedBeside(),
        { width: 1211, height: 400, gutter: 6 },
        b,
        'right'
      )
    ).toBe(false);
  });
});
