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
});
