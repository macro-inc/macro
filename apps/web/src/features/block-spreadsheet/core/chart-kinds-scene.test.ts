import { describe, expect, it } from 'vitest';
import type { ChartData } from './chart-data';
import { chartScene } from './chart-scene';
import type { ChartShape } from './chart-shapes';

const PALETTE = [
  '#4472C4',
  '#ED7D31',
  '#A5A5A5',
  '#FFC000',
  '#5B9BD5',
  '#70AD47',
];

const of = <Type extends ChartShape['type']>(
  shapes: ChartShape[],
  type: Type
) =>
  shapes.filter(
    (shape): shape is Extract<ChartShape, { type: Type }> => shape.type === type
  );
const texts = (shapes: ChartShape[]) =>
  of(shapes, 'text').map((shape) => shape.text);
const tipped = (shapes: ChartShape[], tip: string) =>
  shapes.find((shape) => 'tip' in shape && shape.tip === tip);
/** The corners of a rectangle drawn as a rect or as a closed path. */
function bounds(shape: ChartShape | undefined) {
  if (shape?.type === 'rect')
    return {
      left: shape.x,
      right: shape.x + shape.width,
      top: shape.y,
      bottom: shape.y + shape.height,
    };
  if (shape?.type !== 'path') throw new Error('not a rectangle');
  const numbers = [...shape.d.matchAll(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g)].map(
    (found) => Number(found[0])
  );
  const xs = numbers.filter((_, index) => index % 2 === 0);
  const ys = numbers.filter((_, index) => index % 2 === 1);
  return {
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
    bottom: Math.max(...ys),
  };
}

const data = (
  plot: ChartData['plots'][number],
  categories: string[],
  extra: Partial<ChartData> = {}
): ChartData => ({ categories, plots: [plot], palette: PALETTE, ...extra });

describe('histograms and pareto charts', () => {
  it('draws touching bins labeled with their ranges', () => {
    const { shapes } = chartScene(
      data(
        {
          kind: 'histogram',
          binning: { size: 5 },
          series: [
            {
              name: 'Scores',
              color: '#4472C4',
              values: [1, 2, 5, 6, 10, 11, 20],
            },
          ],
        },
        []
      ),
      480,
      288
    );
    expect(texts(shapes)).toEqual(
      expect.arrayContaining(['[1, 6]', '(6, 11]', '(11, 16]', '(16, 21]'])
    );
    const first = bounds(tipped(shapes, '[1, 6]: 4'));
    const second = bounds(tipped(shapes, '(6, 11]: 2'));
    const last = bounds(tipped(shapes, '(16, 21]: 1'));
    // No gap between bins; heights in proportion to counts.
    expect(second.left).toBeCloseTo(first.right);
    expect(first.bottom - first.top).toBeCloseTo(4 * (last.bottom - last.top));
    expect(tipped(shapes, '(11, 16]: 0')).toBeUndefined();
  });

  it('sums by category when the histogram aggregates', () => {
    const { shapes } = chartScene(
      data(
        {
          kind: 'histogram',
          aggregate: true,
          series: [{ name: 'Sales', color: '#4472C4', values: [1, 2, 3] }],
        },
        ['North', 'South', 'North']
      ),
      480,
      288
    );
    expect(tipped(shapes, 'North: 4')).toBeDefined();
    expect(tipped(shapes, 'South: 2')).toBeDefined();
  });

  it('sorts pareto bars largest first under a cumulative percentage line', () => {
    const { shapes } = chartScene(
      data(
        {
          kind: 'pareto',
          aggregate: true,
          series: [
            { name: 'Defects', color: '#4472C4', values: [10, 40, 30, 20] },
          ],
        },
        ['Dents', 'Scratches', 'Chips', 'Cracks']
      ),
      480,
      288
    );
    const bars = ['Scratches: 40', 'Chips: 30', 'Cracks: 20', 'Dents: 10'].map(
      (tip) => bounds(tipped(shapes, tip))
    );
    for (let index = 1; index < bars.length; index++)
      expect(bars[index].left).toBeGreaterThan(bars[index - 1].left);
    // The secondary axis runs to 100%, and the line ends there.
    expect(texts(shapes)).toEqual(expect.arrayContaining(['0%', '100%']));
    const line = of(shapes, 'path').find(
      (shape) => shape.tip === 'Cumulative %'
    );
    const points = [...(line?.d ?? '').matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map(
      (found) => Number(found[2])
    );
    expect(points).toHaveLength(4);
    const top = Math.min(
      ...bars.map((bar) => bar.top),
      ...of(shapes, 'line').map((shape) => Math.min(shape.y1, shape.y2))
    );
    expect(points[3]).toBeCloseTo(top);
    // 40% of the total is 40% of the way up.
    const bottom = bars[0].bottom;
    expect((bottom - points[0]) / (bottom - points[3])).toBeCloseTo(0.4);
  });
});

describe('waterfall charts', () => {
  const plot: ChartData['plots'][number] = {
    kind: 'waterfall',
    totals: [3],
    labels: true,
    series: [{ name: 'Cash', color: '#4472C4', values: [100, 30, -50, 80] }],
  };

  it('floats changes from the running total and stands totals on zero', () => {
    const { shapes } = chartScene(
      data(plot, ['Start', 'Sales', 'Costs', 'End'], { legend: 'bottom' }),
      480,
      288
    );
    const start = bounds(tipped(shapes, 'Start: 100'));
    const sales = bounds(tipped(shapes, 'Sales: 30'));
    const costs = bounds(tipped(shapes, 'Costs: -50'));
    const end = bounds(tipped(shapes, 'End: 80'));
    const unit = (start.bottom - start.top) / 100;
    expect(sales.bottom).toBeCloseTo(start.top);
    expect(sales.bottom - sales.top).toBeCloseTo(30 * unit);
    expect(costs.top).toBeCloseTo(sales.top);
    expect(costs.bottom - costs.top).toBeCloseTo(50 * unit);
    expect(end.bottom).toBeCloseTo(start.bottom);
    expect(end.top).toBeCloseTo(costs.bottom);
    // Colors by direction, a legend of them, labels and connectors.
    const fill = (tip: string) => {
      const shape = tipped(shapes, tip);
      return shape?.type === 'rect' ? shape.fill : undefined;
    };
    expect([fill('Sales: 30'), fill('Costs: -50'), fill('End: 80')]).toEqual(
      PALETTE.slice(0, 3)
    );
    expect(texts(shapes)).toEqual(
      expect.arrayContaining(['Increase', 'Decrease', 'Total', '-50', '80'])
    );
    expect(of(shapes, 'path').filter((shape) => shape.dash)).toHaveLength(3);
  });

  it('leaves out connectors when asked', () => {
    const { shapes } = chartScene(
      data({ ...plot, noConnectors: true }, ['A', 'B', 'C', 'D']),
      480,
      288
    );
    expect(of(shapes, 'path').filter((shape) => shape.dash)).toHaveLength(0);
  });
});

describe('box and whisker charts', () => {
  it('draws a box from quartile to quartile per category, with outliers', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 40, 5, 6, 7];
    const categories = [
      ...Array.from({ length: 12 }, () => 'East'),
      'West',
      'West',
      'West',
    ];
    const { shapes } = chartScene(
      data(
        {
          kind: 'boxWhisker',
          series: [{ name: 'Times', color: '#4472C4', values }],
        },
        categories
      ),
      480,
      288
    );
    const east = bounds(
      tipped(shapes, 'Times · East: Q1 3.25, median 6.5, Q3 9.75')
    );
    const west = bounds(tipped(shapes, 'Times · West: Q1 5, median 6, Q3 7'));
    expect(west.left).toBeGreaterThan(east.right);
    // One outlier, 40, as a marker; the mean as a marker per box.
    expect(
      of(shapes, 'circle').filter((shape) => shape.tip === 'Times · East: 40')
    ).toHaveLength(1);
    expect(
      of(shapes, 'path').filter((shape) => shape.tip?.includes('mean'))
    ).toHaveLength(2);
    expect(texts(shapes)).toEqual(expect.arrayContaining(['East', 'West']));
  });
});

describe('funnel charts', () => {
  it('centers bars as wide as their values, largest at the top', () => {
    const { shapes } = chartScene(
      data(
        {
          kind: 'funnel',
          labels: true,
          series: [{ name: 'Leads', color: '#4472C4', values: [400, 200, 50] }],
        },
        ['Visits', 'Trials', 'Sales']
      ),
      480,
      288
    );
    const [visits, trials, sales] = [
      'Visits: 400',
      'Trials: 200',
      'Sales: 50',
    ].map((tip) => bounds(tipped(shapes, tip)));
    expect(trials.right - trials.left).toBeCloseTo(
      (visits.right - visits.left) / 2
    );
    expect(sales.right - sales.left).toBeCloseTo(
      (visits.right - visits.left) / 8
    );
    expect((trials.left + trials.right) / 2).toBeCloseTo(
      (visits.left + visits.right) / 2
    );
    expect(visits.top).toBeLessThan(trials.top);
    expect(texts(shapes)).toEqual(
      expect.arrayContaining(['Visits', '400', '200', '50'])
    );
  });
});

describe('treemaps and sunbursts', () => {
  const paths = [
    ['Fruit', 'Apple'],
    ['', 'Pear'],
    ['Veg', 'Leek'],
    ['Nuts', ''],
  ];
  const series = [{ name: 'Sales', color: '#4472C4', values: [3, 5, 2, 4] }];

  it('tiles the plot area by size, colored by branch', () => {
    const { shapes } = chartScene(
      data({ kind: 'treemap', series }, ['Apple', 'Pear', 'Leek', 'Nuts'], {
        paths,
        legend: 'right',
      }),
      480,
      288
    );
    const area = (tip: string) => {
      const box = bounds(tipped(shapes, tip));
      return (box.right - box.left) * (box.bottom - box.top);
    };
    expect(area('Fruit › Pear: 5') / area('Veg › Leek: 2')).toBeCloseTo(2.5);
    expect(area('Nuts: 4') / area('Fruit › Apple: 3')).toBeCloseTo(4 / 3);
    const fill = (tip: string) => {
      const shape = tipped(shapes, tip);
      return shape?.type === 'rect' ? shape.fill : undefined;
    };
    expect(fill('Fruit › Pear: 5')).toBe(fill('Fruit › Apple: 3'));
    expect(fill('Fruit › Pear: 5')).not.toBe(fill('Veg › Leek: 2'));
    // The legend lists branches; parents are written over their tiles.
    expect(texts(shapes)).toEqual(
      expect.arrayContaining(['Fruit', 'Nuts', 'Veg', 'Pear'])
    );
  });

  it('gives banner labels a strip of their own', () => {
    const banner = chartScene(
      data(
        { kind: 'treemap', parentLabels: 'banner', series },
        ['Apple', 'Pear', 'Leek', 'Nuts'],
        { paths }
      ),
      480,
      288
    ).shapes;
    const strip = bounds(tipped(banner, 'Fruit: 8'));
    const pear = bounds(tipped(banner, 'Fruit › Pear: 5'));
    expect(pear.top).toBeGreaterThan(strip.top + 5);
  });

  it('rings each level around the one it belongs to', () => {
    const { shapes } = chartScene(
      data({ kind: 'sunburst', series }, ['Apple', 'Pear', 'Leek', 'Nuts'], {
        paths,
      }),
      480,
      288
    );
    const arcs = of(shapes, 'path');
    expect(arcs.map((shape) => shape.tip)).toEqual([
      'Fruit: 8',
      'Fruit › Pear: 5',
      'Fruit › Apple: 3',
      'Nuts: 4',
      'Veg: 2',
      'Veg › Leek: 2',
    ]);
    // Arcs share the chart's center.
    const centers = new Set(arcs.map((shape) => shape.translate?.join()));
    expect(centers.size).toBe(1);
  });
});

describe('pie of pie and bar of pie', () => {
  const values = [40, 30, 12, 8, 6, 4];
  const categories = ['A', 'B', 'C', 'D', 'E', 'F'];

  it('gathers the split points into one slice and shows them beside it', () => {
    const { shapes } = chartScene(
      data(
        {
          kind: 'pie',
          ofPie: { type: 'pie', split: 'position', splitAt: 3 },
          series: [{ name: 'Share', color: '#4472C4', values }],
        },
        categories
      ),
      480,
      288
    );
    const slices = of(shapes, 'path').filter((shape) => shape.translate);
    expect(slices.map((shape) => shape.tip)).toEqual([
      'A: 40%',
      'B: 30%',
      'C: 12%',
      'Other: 18%',
      'D: 8%',
      'E: 6%',
      'F: 4%',
    ]);
    const [main, second] = [
      ...new Set(slices.map((shape) => shape.translate?.join())),
    ].map((center) => center?.split(',').map(Number) ?? []);
    expect(second[0]).toBeGreaterThan(main[0]);
    expect(second[1]).toBeCloseTo(main[1]);
    // Past the six accents, Excel shades them: the gathered slice is the
    // seventh color, a darker first accent, not the first again.
    const fill = (tip: string) =>
      slices.find((shape) => shape.tip === tip)?.fill;
    expect(fill('Other: 18%')).toBe('#264478');
    expect(fill('A: 40%')).toBe('#4472C4');
    // Two lines join the gathered slice to the second pie.
    expect(
      of(shapes, 'path').filter((shape) => !shape.translate && shape.stroke)
    ).toHaveLength(2);
  });

  it('stacks the split points in a bar', () => {
    const { shapes } = chartScene(
      data(
        {
          kind: 'pie',
          ofPie: { type: 'bar', split: 'value', splitAt: 10 },
          series: [{ name: 'Share', color: '#4472C4', values }],
        },
        categories
      ),
      480,
      288
    );
    const [d, e, f] = ['D: 8%', 'E: 6%', 'F: 4%'].map((tip) =>
      bounds(tipped(shapes, tip))
    );
    expect(e.top).toBeCloseTo(d.bottom);
    expect(f.top).toBeCloseTo(e.bottom);
    expect((d.bottom - d.top) / (f.bottom - f.top)).toBeCloseTo(2);
  });
});
