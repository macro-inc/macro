import type { SheetChart } from '@macro-inc/spreadsheet/sheet-drawings';
import { describe, expect, it } from 'vitest';
import { type ChartData, type ChartReader, chartData } from './chart-data';
import { type ChartShape, chartScene } from './chart-scene';

const months = ['Jan', 'Feb', 'Mar'];
const data = (plots: ChartData['plots'], extra: Partial<ChartData> = {}) => ({
  categories: months,
  plots,
  palette: ['#111111', '#222222'],
  ...extra,
});
const series = (
  name: string,
  values: (number | null)[],
  extra: Partial<ChartData['plots'][number]['series'][number]> = {}
) => ({ name, color: name === 'A' ? '#111111' : '#222222', values, ...extra });
const of = <Type extends ChartShape['type']>(
  shapes: ChartShape[],
  type: Type
) =>
  shapes.filter(
    (shape): shape is Extract<ChartShape, { type: Type }> => shape.type === type
  );
const labels = (shapes: ChartShape[]) =>
  of(shapes, 'text').map((shape) => shape.text);

describe('chart layout', () => {
  it('formats value labels like the cells they chart', () => {
    const currency = chartScene(
      data([
        {
          kind: 'column',
          series: [series('A', [1000, 2500, -500], { sample: '$1,000.00' })],
        },
      ]),
      400,
      300
    ).shapes;
    expect(labels(currency)).toEqual(
      expect.arrayContaining(['-$500', '$0', '$2,500'])
    );
    const percent = chartScene(
      data([
        {
          kind: 'line',
          series: [series('A', [0.1, 0.25, 0.4], { sample: '10%' })],
        },
      ]),
      400,
      300
    ).shapes;
    expect(labels(percent)).toEqual(expect.arrayContaining(['10%', '40%']));
  });

  it('breaks lines at blank cells', () => {
    const shapes = chartScene(
      data([{ kind: 'line', series: [series('A', [1, null, 3])] }], {
        categories: ['Jan', 'Feb', 'Mar'],
      }),
      400,
      300
    ).shapes;
    const [line] = of(shapes, 'path');
    expect(line.d.match(/M/g)).toHaveLength(2);
    expect(of(shapes, 'circle')).toHaveLength(2);
  });

  it('stacks bars, and fills the axis for percentages', () => {
    const stacked = chartScene(
      data([
        {
          kind: 'bar',
          grouping: 'stacked',
          series: [series('A', [10, 20, 30]), series('B', [5, 5, 5])],
        },
      ]),
      400,
      300
    ).shapes;
    const bar = (tip: string) =>
      of(stacked, 'rect').find((shape) => shape.tip === tip);
    // Horizontal bars: the second series starts where the first ends.
    expect(bar('B · Jan: 5')?.x).toBeCloseTo(
      (bar('A · Jan: 10')?.x ?? 0) + (bar('A · Jan: 10')?.width ?? 0)
    );
    const percent = chartScene(
      data([
        {
          kind: 'column',
          grouping: 'percentStacked',
          series: [series('A', [10, 20, 30]), series('B', [30, 20, 10])],
        },
      ]),
      400,
      300
    ).shapes;
    const heights = months.map((month) =>
      of(percent, 'rect')
        .filter((shape) => shape.tip?.includes(`· ${month}:`))
        .reduce((total, shape) => total + shape.height, 0)
    );
    expect(heights[0]).toBeCloseTo(heights[1]);
    expect(heights[1]).toBeCloseTo(heights[2]);
  });

  it('labels a secondary axis on the right and keeps series without fill out of the legend', () => {
    const shapes = chartScene(
      data(
        [
          {
            kind: 'column',
            series: [
              series('A', [10, 20, 30]),
              series('Spacer', [1, 1, 1], { noFill: true }),
            ],
          },
          {
            kind: 'line',
            secondary: true,
            series: [series('B', [0.1, 0.2, 0.3])],
          },
        ],
        { legend: 'bottom' }
      ),
      400,
      300
    ).shapes;
    const right = of(shapes, 'text').filter(
      (shape) => shape.anchor === 'start'
    );
    expect(right.map((shape) => shape.text)).toEqual(
      expect.arrayContaining(['0.3'])
    );
    expect(labels(shapes)).toContain('A');
    expect(labels(shapes)).not.toContain('Spacer');
    expect(
      of(shapes, 'rect').some((shape) => shape.tip?.startsWith('Spacer'))
    ).toBe(false);
  });

  it('draws only what fits in a small box', () => {
    const shapes = chartScene(
      data([{ kind: 'column', series: [series('A', [1, 2, 3])] }], {
        title: 'A very long chart title that cannot fit',
        legend: 'right',
      }),
      30,
      20
    ).shapes;
    expect(of(shapes, 'rect').filter((shape) => shape.tip)).toEqual([]);
    expect(labels(shapes)[0]).toMatch(/…$/);
  });
});

describe('radar, bubble, stock and contour charts', () => {
  it('draws a radar chart: a spoke per category and a ring of each series', () => {
    const plot = (filled?: boolean) =>
      chartScene(
        data([
          {
            kind: 'radar',
            ...(filled && { filled: true }),
            series: [series('A', [1, 2, 3]), series('B', [3, 2, null])],
          },
        ]),
        400,
        300
      ).shapes;
    const marked = plot();
    const center = of(marked, 'line')[0];
    expect(
      of(marked, 'line').filter(
        (line) => line.x1 === center.x1 && line.y1 === center.y1
      )
    ).toHaveLength(3);
    // The first spoke points up.
    expect(center.x2).toBeCloseTo(center.x1);
    expect(center.y2).toBeLessThan(center.y1);
    expect(labels(marked)).toEqual(expect.arrayContaining(months));
    const rings = of(marked, 'path').filter((path) => path.tip);
    expect(rings.map((ring) => ring.tip)).toEqual(['A', 'B']);
    // A blank value leaves its point out.
    expect(rings[1].d.match(/L/g)).toHaveLength(1);
    expect(of(marked, 'circle')).toHaveLength(5);
    const filled = plot(true);
    expect(
      of(filled, 'path')
        .filter((path) => path.tip)
        .map((path) => [path.fill, path.opacity])
    ).toEqual([
      ['#111111', 0.5],
      ['#222222', 0.5],
    ]);
    expect(of(filled, 'circle')).toHaveLength(0);
  });

  it('sizes bubbles by area', () => {
    const shapes = chartScene(
      data([
        {
          kind: 'bubble',
          series: [series('A', [10, 20], { x: [1, 2], sizes: [1, 4] })],
        },
      ]),
      400,
      300
    ).shapes;
    const [small, large] = of(shapes, 'circle');
    expect(large.r / small.r).toBeCloseTo(2);
    expect(large.tip).toBe('A: (2, 20), 4');
    expect(large.x).toBeGreaterThan(small.x);
    expect(large.y).toBeLessThan(small.y);
  });

  it('draws prices as high-low lines with bars from open to close', () => {
    const prices = [
      series('Open', [100, 108, 104]),
      series('High', [110, 112, 106]),
      series('Low', [98, 103, 100]),
      series('Close', [108, 104, 104]),
    ];
    const shapes = chartScene(
      data([{ kind: 'stock', hiLow: true, upDown: true, series: prices }]),
      400,
      300
    ).shapes;
    const tips = of(shapes, 'path').map((path) => path.tip);
    expect(tips).toEqual([
      'Jan: high 110, low 98',
      'Jan: open 100, close 108',
      'Feb: high 112, low 103',
      'Feb: open 108, close 104',
      'Mar: high 106, low 100',
      'Mar: open 104, close 104',
    ]);
    const bar = (tip: string) =>
      of(shapes, 'path').find((path) => path.tip === tip);
    // Rising days are hollow, falling days solid.
    expect(bar('Jan: open 100, close 108')?.fill).toBe('var(--color-surface)');
    expect(bar('Feb: open 108, close 104')?.fill).toBe('var(--color-ink)');
    // Without up-down bars, the close is a tick.
    const closes = chartScene(
      data([{ kind: 'stock', hiLow: true, series: prices.slice(1) }]),
      400,
      300
    ).shapes;
    expect(
      of(closes, 'path')
        .map((path) => path.tip)
        .filter((tip) => tip?.startsWith('Close'))
    ).toEqual(['Close · Jan: 108', 'Close · Feb: 104', 'Close · Mar: 104']);
    // Prices far from zero leave it off the axis.
    expect(labels(shapes)).not.toContain('0');
  });

  it('draws a surface from above, in bands of value', () => {
    const shapes = chartScene(
      data(
        [
          {
            kind: 'surface',
            series: [series('A', [0, 25, 50]), series('B', [75, 100, null])],
          },
        ],
        {
          legend: 'right',
          palette: ['#000001', '#000002', '#000003', '#000004', '#000005'],
        }
      ),
      400,
      300
    ).shapes;
    const cells = of(shapes, 'rect').filter((rect) => rect.tip);
    expect(cells.map((cell) => [cell.tip, cell.fill])).toEqual([
      ['A · Jan: 0', '#000001'],
      ['A · Feb: 25', '#000002'],
      ['A · Mar: 50', '#000003'],
      ['B · Jan: 75', '#000004'],
      ['B · Feb: 100', '#000005'],
    ]);
    // The first series is at the bottom.
    expect(cells[0].y).toBeGreaterThan(cells[3].y);
    // The legend names each band.
    expect(labels(shapes)).toEqual(
      expect.arrayContaining(['0–20', '20–40', '80–100', 'A', 'B'])
    );
  });
});

describe('chart data', () => {
  const cells: Record<string, string[]> = {
    'Model!A1:A1': ['Revenue', 'forecast'],
    'Model!B2:B4': ['1', '', 'n/a'],
  };
  const read: ChartReader = (range) =>
    cells[
      `${range.sheet}!${String.fromCharCode(65 + range.left)}${range.top + 1}:${String.fromCharCode(65 + range.right)}${range.bottom + 1}`
    ]?.map((text) => ({
      text,
      ...(Number.isFinite(Number(text)) &&
        text !== '' && { number: Number(text) }),
    }));
  const chart = (references: string[]): SheetChart => ({
    plots: [
      {
        kind: 'column',
        series: [{ nameRef: 0, values: 1 }, { values: 2 }],
      },
    ],
    references,
  });

  it('resolves defined names and joins names that span cells', () => {
    const result = chartData(
      chart(['Model!$A$1:$A$1', '[0]!Sales', 'Missing!$A$1']),
      read,
      [{ name: 'Sales', formula: '=Model!$B$2:$B$4' }]
    );
    expect(result.categories).toEqual(['1', '2', '3']);
    expect(result.plots[0].series).toMatchObject([
      // Text and blanks are gaps, as in Excel.
      { name: 'Revenue forecast', values: [1, null, null], sample: '1' },
      { name: 'Series 2', values: [] },
    ]);
  });

  it('numbers the points of a scatter chart whose x values include text', () => {
    const scatter = (labels: string[]) =>
      chartData(
        {
          plots: [{ kind: 'scatter', series: [{ categories: 0, values: 1 }] }],
          references: [`{${labels.join(',')}}`, '{4,5,6}'],
        },
        () => undefined
      ).plots[0].series[0].x;
    expect(scatter(['10', '20', ''])).toEqual([10, 20, null]);
    expect(scatter(['10', '"Feb"', '30'])).toEqual([1, 2, 3]);
  });
});
