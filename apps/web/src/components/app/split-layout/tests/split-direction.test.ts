import type { PaneId, PaneLayout } from '@app/lib/split-router';
import { describe, expect, it } from 'vitest';
import { adjacentPane } from '../split-direction';

const [l1, l2, r1, r2, r3] = ['l1', 'l2', 'r1', 'r2', 'r3'] as PaneId[];
const [a, b, c, d] = ['a', 'b', 'c', 'd'] as PaneId[];

const leaf = (pane: PaneId): PaneLayout => ({ type: 'pane', pane });

// Two stacked splits on the left, three on the right.
const twoBesideThree: PaneLayout = {
  type: 'split',
  axis: 'row',
  shares: [0.5, 0.5],
  children: [
    {
      type: 'split',
      axis: 'column',
      shares: [0.5, 0.5],
      children: [leaf(l1), leaf(l2)],
    },
    {
      type: 'split',
      axis: 'column',
      shares: [1 / 3, 1 / 3, 1 / 3],
      children: [leaf(r1), leaf(r2), leaf(r3)],
    },
  ],
};

describe('adjacentPane on two splits beside three', () => {
  it.each([
    [l1, 'up', l2],
    [l1, 'down', l2],
    [l1, 'left', r1],
    [l1, 'right', r1],
    [l2, 'up', l1],
    [l2, 'down', l1],
    [l2, 'left', r3],
    [l2, 'right', r3],
    [r1, 'up', r3],
    [r1, 'down', r2],
    [r1, 'left', l1],
    [r1, 'right', l1],
    [r2, 'up', r1],
    [r2, 'down', r3],
    [r2, 'left', l1],
    [r2, 'right', l1],
    [r3, 'up', r2],
    [r3, 'down', r1],
    [r3, 'left', l2],
    [r3, 'right', l2],
  ] as const)('from %s %s goes to %s', (from, direction, target) => {
    expect(adjacentPane(twoBesideThree, from, direction)).toBe(target);
  });

  it('returns to the split it came from', () => {
    expect(adjacentPane(twoBesideThree, l1, 'right', r2)).toBe(r2);
    expect(adjacentPane(twoBesideThree, l2, 'right', r2)).toBe(r2);
    expect(adjacentPane(twoBesideThree, r2, 'left', l2)).toBe(l2);
  });

  it('ignores a previous split that is not beside it that way', () => {
    expect(adjacentPane(twoBesideThree, l1, 'right', r3)).toBe(r1);
    expect(adjacentPane(twoBesideThree, r1, 'down', l2)).toBe(r2);
  });
});

describe('adjacentPane on nested layouts', () => {
  // a | b side by side over c across the full width.
  const rowOverFullWidth: PaneLayout = {
    type: 'split',
    axis: 'column',
    shares: [0.5, 0.5],
    children: [
      {
        type: 'split',
        axis: 'row',
        shares: [0.5, 0.5],
        children: [leaf(a), leaf(b)],
      },
      leaf(c),
    ],
  };

  it('moves between a row and the split stacked under it', () => {
    expect(adjacentPane(rowOverFullWidth, a, 'down')).toBe(c);
    expect(adjacentPane(rowOverFullWidth, b, 'down')).toBe(c);
    expect(adjacentPane(rowOverFullWidth, c, 'up')).toBe(a);
    expect(adjacentPane(rowOverFullWidth, c, 'up', b)).toBe(b);
    expect(adjacentPane(rowOverFullWidth, a, 'right')).toBe(b);
    expect(adjacentPane(rowOverFullWidth, b, 'right')).toBe(a);
  });

  it('stays put when no other split lies that way', () => {
    expect(adjacentPane(rowOverFullWidth, c, 'left')).toBeUndefined();
    expect(adjacentPane(rowOverFullWidth, c, 'right')).toBeUndefined();
  });

  // a | (b over (c | d)), with uneven shares.
  const deep: PaneLayout = {
    type: 'split',
    axis: 'row',
    shares: [0.4, 0.6],
    children: [
      leaf(a),
      {
        type: 'split',
        axis: 'column',
        shares: [0.3, 0.7],
        children: [
          leaf(b),
          {
            type: 'split',
            axis: 'row',
            shares: [0.25, 0.75],
            children: [leaf(c), leaf(d)],
          },
        ],
      },
    ],
  };

  it('follows the tiles through deeper nesting', () => {
    expect(adjacentPane(deep, a, 'right')).toBe(c);
    expect(adjacentPane(deep, a, 'right', b)).toBe(b);
    expect(adjacentPane(deep, c, 'left')).toBe(a);
    expect(adjacentPane(deep, d, 'left')).toBe(c);
    expect(adjacentPane(deep, b, 'down')).toBe(d);
    expect(adjacentPane(deep, c, 'up')).toBe(b);
    expect(adjacentPane(deep, d, 'down')).toBe(b);
    expect(adjacentPane(deep, a, 'up')).toBeUndefined();
  });

  it('wraps across side-by-side splits as before', () => {
    const row: PaneLayout = {
      type: 'split',
      axis: 'row',
      shares: [1 / 3, 1 / 3, 1 / 3],
      children: [leaf(a), leaf(b), leaf(c)],
    };

    expect(adjacentPane(row, a, 'right')).toBe(b);
    expect(adjacentPane(row, c, 'right')).toBe(a);
    expect(adjacentPane(row, a, 'left')).toBe(c);
    expect(adjacentPane(row, b, 'up')).toBeUndefined();
  });
});
