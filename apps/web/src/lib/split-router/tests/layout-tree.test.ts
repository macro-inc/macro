import { describe, expect, it } from 'vitest';
import {
  fillShape,
  insertColumn,
  layoutShape,
  type PaneLayout,
  paneIds,
  removePane,
  reorderPanes,
  resizeSplit,
  rowLayout,
  splitPane,
  withSharesFrom,
} from '../panes/layout-tree';
import type { PaneId } from '../panes/types';
import { formatLayoutShape, parseLayoutShape } from '../routes/layout-param';

const [a, b, c, d] = ['a', 'b', 'c', 'd'] as PaneId[];

const leaf = (pane: PaneId): PaneLayout => ({ type: 'pane', pane });

describe('layout tree', () => {
  it('stacks a pane below another inside a row, keeping the row', () => {
    const layout = splitPane(rowLayout([a, b])!, b, c, 'below');

    expect(layout).toEqual({
      type: 'split',
      axis: 'row',
      shares: [0.5, 0.5],
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
    expect(paneIds(layout)).toEqual(['a', 'b', 'c']);
  });

  it('adds a sibling on the same axis with an equal share', () => {
    const layout = splitPane(rowLayout([a, b])!, a, c, 'left');

    expect(layout).toEqual({
      type: 'split',
      axis: 'row',
      shares: [
        expect.closeTo(1 / 3),
        expect.closeTo(1 / 3),
        expect.closeTo(1 / 3),
      ],
      children: [leaf(c), leaf(a), leaf(b)],
    });
  });

  it('splits a stacked pane side by side within its column', () => {
    const stacked = splitPane(leaf(a), a, b, 'above');
    const layout = splitPane(stacked, a, c, 'right');

    expect(layoutShape(layout)).toEqual({
      axis: 'column',
      children: ['pane', { axis: 'row', children: ['pane', 'pane'] }],
    });
    expect(paneIds(layout)).toEqual(['b', 'a', 'c']);
  });

  it('adds a full-height column after the column holding the anchor', () => {
    const layout = splitPane(rowLayout([a, b])!, a, c, 'below');

    const inserted = insertColumn(layout, d, c);

    expect(paneIds(inserted)).toEqual(['a', 'c', 'd', 'b']);
    expect(inserted).toMatchObject({ axis: 'row', children: { length: 3 } });
    expect(insertColumn(layout, d, undefined)).toMatchObject({
      children: [leaf(d), {}, {}],
    });
  });

  it('wraps a stacked root in a row for a new column', () => {
    const stacked = splitPane(leaf(a), a, b, 'below');

    expect(layoutShape(insertColumn(stacked, c, b))).toEqual({
      axis: 'row',
      children: [{ axis: 'column', children: ['pane', 'pane'] }, 'pane'],
    });
  });

  it('collapses a split left with one pane and merges it into its parent', () => {
    // a | (b over (c | d)): removing b leaves c and d beside a in one row.
    let layout = splitPane(rowLayout([a, b])!, b, c, 'below');
    layout = splitPane(layout, c, d, 'right');

    const removed = removePane(layout, b);

    expect(removed).toEqual({
      type: 'split',
      axis: 'row',
      shares: [0.5, 0.25, 0.25],
      children: [leaf(a), leaf(c), leaf(d)],
    });
    expect(removePane(removePane(removePane(removed, a), c), d)).toBe(
      undefined
    );
  });

  it('keeps the tiles and sizes when the panes reorder', () => {
    const layout = resizeSplit(
      splitPane(rowLayout([a, b])!, b, c, 'below'),
      [],
      [0.7, 0.3]
    );

    const reordered = reorderPanes(layout, [c, a, b]);

    expect(paneIds(reordered)).toEqual(['c', 'a', 'b']);
    expect(reordered).toMatchObject({ shares: [0.7, 0.3] });
    expect(layoutShape(reordered!)).toEqual(layoutShape(layout!));
  });

  it('keeps the current sizes where an incoming shape matches', () => {
    const current = resizeSplit(
      resizeSplit(splitPane(rowLayout([a, b])!, b, c, 'below'), [], [0.7, 0.3]),
      [1],
      [0.2, 0.8]
    );
    const sameShape = fillShape(layoutShape(current!), [a, b, c]);
    const otherShape = rowLayout([a, b, c]);

    expect(withSharesFrom(sameShape, current)).toEqual(current);
    expect(withSharesFrom(otherShape, current)).toMatchObject({
      shares: [1 / 3, 1 / 3, 1 / 3],
    });
  });
});

describe('layout search value', () => {
  it('round-trips a nested shape in preorder', () => {
    const layout = splitPane(
      splitPane(rowLayout([a, b])!, b, c, 'below'),
      c,
      d,
      'right'
    );
    const value = formatLayoutShape(layoutShape(layout));

    expect(value).toBe('r2pc2pr2pp');
    expect(parseLayoutShape(value)).toEqual(layoutShape(layout));
  });

  it('rejects values the router would never write', () => {
    expect(parseLayoutShape('')).toBeUndefined();
    expect(parseLayoutShape('c1p')).toBeUndefined();
    expect(parseLayoutShape('c2pr')).toBeUndefined();
    expect(parseLayoutShape('c2ppp')).toBeUndefined();
    expect(parseLayoutShape('c2pc2pp')).toBeUndefined();
    expect(parseLayoutShape('c02pp')).toBeUndefined();
    expect(parseLayoutShape(`c2${'p'.repeat(600)}`)).toBeUndefined();
  });

  it('fills a shape only with as many panes as it has', () => {
    const shape = parseLayoutShape('c2pp')!;

    expect(fillShape(shape, [a, b])).toEqual({
      type: 'split',
      axis: 'column',
      shares: [0.5, 0.5],
      children: [leaf(a), leaf(b)],
    });
    expect(fillShape(shape, [a, b, c])).toBeUndefined();
  });
});
