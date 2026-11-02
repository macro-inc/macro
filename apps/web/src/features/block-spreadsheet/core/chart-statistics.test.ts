import { describe, expect, it } from 'vitest';
import {
  binLabels,
  boxStatistics,
  hierarchy,
  histogramBins,
  ofPieSecond,
  paretoOrder,
  quartile,
  squarify,
  sumByCategory,
  sunburst,
  waterfallSteps,
} from './chart-statistics';

const plain = (value: number) => String(value);

describe('histogram bins', () => {
  it('uses bins of a width from the smallest value, each holding its upper edge', () => {
    const bins = histogramBins([1, 2, 5, 6, 10, 11, 20], { size: 5 });
    expect(bins).toEqual([
      { low: 1, high: 6, count: 4 },
      { low: 6, high: 11, count: 2 },
      { low: 11, high: 16, count: 0 },
      { low: 16, high: 21, count: 1 },
    ]);
    expect(binLabels(bins, false, plain)).toEqual([
      '[1, 6]',
      '(6, 11]',
      '(11, 16]',
      '(16, 21]',
    ]);
  });

  it('holds lower edges when bins are closed on the left', () => {
    const bins = histogramBins([1, 2, 5, 6, 10, 11, 20], {
      size: 5,
      closedLeft: true,
    });
    expect(bins.map((bin) => bin.count)).toEqual([3, 2, 1, 1]);
    expect(binLabels(bins, true, plain)).toEqual([
      '[1, 6)',
      '[6, 11)',
      '[11, 16)',
      '[16, 21]',
    ]);
  });

  it('splits the range into a number of bins, the last ending at the largest value', () => {
    const bins = histogramBins([0, 0.1, 0.2, 0.3, 0.6, 0.9], { count: 3 });
    // 0.3 is an edge: it belongs to the first bin, (0, 0.3].
    expect(bins.map((bin) => bin.count)).toEqual([4, 1, 1]);
    expect(bins[2].high).toBeCloseTo(0.9);
  });

  it('gathers values past the underflow and overflow edges', () => {
    const bins = histogramBins([1, 3, 4, 5, 7, 9, 12, 30], {
      size: 2,
      underflow: 3,
      overflow: 9,
    });
    expect(bins).toEqual([
      { low: 3, high: 3, count: 2, edge: 'under' },
      { low: 3, high: 5, count: 2 },
      { low: 5, high: 7, count: 1 },
      { low: 7, high: 9, count: 1 },
      { low: 9, high: 9, count: 2, edge: 'over' },
    ]);
    expect(binLabels(bins, false, plain)).toEqual([
      '≤3',
      '(3, 5]',
      '(5, 7]',
      '(7, 9]',
      '>9',
    ]);
    expect(
      binLabels(
        histogramBins([1, 3, 9, 12], {
          size: 3,
          underflow: 3,
          overflow: 9,
          closedLeft: true,
        }),
        true,
        plain
      )
    ).toEqual(['<3', '[3, 6)', '[6, 9)', '≥9']);
  });

  it("sizes automatic bins by Scott's rule", () => {
    // Sample standard deviation 2.138, so 3.5 × 2.138 / ∛8 = 3.742.
    const values = [2, 4, 4, 4, 5, 5, 7, 9];
    const bins = histogramBins(values, {});
    expect(bins[0].low).toBe(2);
    expect(bins[0].high - bins[0].low).toBeCloseTo(3.7417, 3);
    expect(bins).toHaveLength(2);
    expect(bins.map((bin) => bin.count)).toEqual([6, 2]);
  });

  it('puts equal values in one bin and draws nothing for no values', () => {
    expect(histogramBins([4, 4, 4], {})).toEqual([
      { low: 4, high: 4, count: 3 },
    ]);
    expect(histogramBins([], {})).toEqual([]);
  });
});

describe('categories and pareto order', () => {
  it('sums values by category in the order categories first appear', () => {
    expect(
      sumByCategory(['B', 'A', 'B', 'C', 'A'], [1, 2, 3, null, 4])
    ).toEqual([
      { name: 'B', value: 4 },
      { name: 'A', value: 6 },
      { name: 'C', value: 0 },
    ]);
  });

  it('sorts largest first and accumulates percentages to 100%', () => {
    expect(paretoOrder([10, 40, 30, 20])).toEqual({
      order: [1, 2, 3, 0],
      cumulative: [0.4, 0.7, 0.9, 1],
    });
  });
});

describe('quartiles and boxes', () => {
  const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

  it('computes exclusive and inclusive quartiles as QUARTILE.EXC and QUARTILE.INC', () => {
    const sorted = [6, 7, 15, 36, 39, 40, 41, 42, 43, 47, 49];
    expect(quartile(sorted, 0.25, 'exclusive')).toBe(15);
    expect(quartile(sorted, 0.75, 'exclusive')).toBe(43);
    expect(quartile(sorted, 0.25, 'inclusive')).toBe(25.5);
    expect(quartile(sorted, 0.75, 'inclusive')).toBe(42.5);
    expect(quartile([1, 2, 3, 4], 0.25, 'exclusive')).toBe(1.25);
    expect(quartile([1, 2, 3, 4], 0.5, 'exclusive')).toBe(2.5);
  });

  it('ends whiskers at the last values within 1.5 boxes, past which are outliers', () => {
    const box = boxStatistics([...values, 40, -30], 'exclusive');
    expect(box.median).toBe(6);
    expect(box.q1).toBe(2.5);
    expect(box.q3).toBe(9.5);
    expect(box.low).toBe(1);
    expect(box.high).toBe(11);
    expect(box.outliers).toEqual([-30, 40]);
    expect(box.inner).toEqual(values);
    expect(box.mean).toBeCloseTo((66 + 10) / 13);
  });
});

describe('waterfall', () => {
  it('floats changes from the running total and measures totals from zero', () => {
    expect(waterfallSteps([100, 30, -50, 80, null, 20], [3])).toEqual([
      { from: 0, to: 100, kind: 'increase' },
      { from: 100, to: 130, kind: 'increase' },
      { from: 130, to: 80, kind: 'decrease' },
      { from: 0, to: 80, kind: 'total' },
      undefined,
      { from: 80, to: 100, kind: 'increase' },
    ]);
  });
});

describe('hierarchies', () => {
  it('nests paths, continuing blank parents and ending at blank leaves', () => {
    const tree = hierarchy(
      [
        ['Fruit', 'Apple'],
        ['', 'Pear'],
        ['Veg', 'Leek'],
        ['Nuts', ''],
      ],
      [3, 5, 2, 4]
    );
    expect(tree).toEqual([
      {
        name: 'Fruit',
        value: 8,
        children: [
          { name: 'Pear', value: 5, children: [], point: 1 },
          { name: 'Apple', value: 3, children: [], point: 0 },
        ],
      },
      { name: 'Nuts', value: 4, children: [], point: 3 },
      {
        name: 'Veg',
        value: 2,
        children: [{ name: 'Leek', value: 2, children: [], point: 2 }],
      },
    ]);
  });

  it('leaves out points without a positive size', () => {
    expect(hierarchy([['A'], ['B'], ['C']], [0, -1, null])).toEqual([]);
  });

  it('squarifies areas in proportion to values', () => {
    const rects = squarify([6, 6, 4, 3, 2, 2, 1], {
      x: 0,
      y: 0,
      width: 6,
      height: 4,
    });
    for (const [index, value] of [6, 6, 4, 3, 2, 2, 1].entries())
      expect(rects[index].width * rects[index].height).toBeCloseTo(value);
    // Every rectangle stays inside, and none is a sliver.
    for (const rect of rects) {
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(6 + 1e-9);
      expect(rect.y + rect.height).toBeLessThanOrEqual(4 + 1e-9);
      expect(
        Math.max(rect.width / rect.height, rect.height / rect.width)
      ).toBeLessThan(3);
    }
  });

  it('divides rings by value from twelve o’clock, clockwise', () => {
    const tree = hierarchy(
      [
        ['A', 'x'],
        ['A', 'y'],
        ['B', ''],
      ],
      [1, 1, 2]
    );
    const arcs = sunburst(tree);
    expect(
      arcs.map(({ node, depth, start, end }) => [node.name, depth, start, end])
    ).toEqual([
      ['A', 0, 0, Math.PI],
      ['x', 1, 0, Math.PI / 2],
      ['y', 1, Math.PI / 2, Math.PI],
      ['B', 0, Math.PI, 2 * Math.PI],
    ]);
  });
});

describe('pie of pie', () => {
  const values = [40, 30, 12, 8, 6, 4];

  it('moves points by position, value, percent or choice', () => {
    expect(ofPieSecond(values, { type: 'pie' })).toEqual([4, 5]);
    expect(
      ofPieSecond(values, { type: 'pie', split: 'position', splitAt: 3 })
    ).toEqual([3, 4, 5]);
    expect(
      ofPieSecond(values, { type: 'bar', split: 'value', splitAt: 10 })
    ).toEqual([3, 4, 5]);
    expect(
      ofPieSecond(values, { type: 'bar', split: 'percent', splitAt: 7 })
    ).toEqual([4, 5]);
    expect(
      ofPieSecond(values, { type: 'pie', split: 'custom', custom: [0, 9] })
    ).toEqual([0]);
  });
});
