import { describe, expect, it } from 'vitest';
import {
  parseChartReference,
  type SheetDrawing,
  validDrawings,
  validImageUrl,
} from './sheet-drawings';

const chart: SheetDrawing = {
  id: 'chart',
  type: 'chart',
  from: { row: 1, column: 8, x: 0, y: 0 },
  to: { row: 15, column: 15, x: 12, y: 4 },
  chart: {
    title: 'Revenue',
    legend: 'right',
    plots: [
      {
        kind: 'column',
        grouping: 'stacked',
        series: [{ nameRef: 0, categories: 1, values: 2, color: '#4472C4' }],
      },
      {
        kind: 'line',
        secondary: true,
        series: [{ name: 'Margin', values: 3 }],
      },
    ],
    references: [
      'Sales!B1',
      'Sales!$A$2:$A$7',
      'Sales!$B$2:$B$7',
      'Sales!$D$2:$D$7',
    ],
    colors: ['#4472C4', '#ED7D31'],
    source: '<c:chartSpace/>',
  },
};
const image: SheetDrawing = {
  id: 'logo',
  type: 'image',
  image: '0123456789abcdef',
  description: 'Company logo',
  from: { row: 9, column: 0, x: 0, y: 0 },
  width: 160,
  height: 60,
};

describe('sheet drawings', () => {
  it('accepts charts and images', () => {
    expect(validDrawings([chart, image])).toBe(true);
  });

  it.each([
    [
      'a series reading a missing reference',
      { ...chart, chart: { ...chart.chart, references: ['Sales!B1'] } },
    ],
    [
      'an unknown chart kind',
      {
        ...chart,
        chart: { ...chart.chart, plots: [{ kind: 'radar', series: [] }] },
      },
    ],
    [
      'a named color',
      { ...chart, chart: { ...chart.chart, colors: ['blue'] } },
    ],
    ['both corners and a size', { ...chart, width: 10, height: 10 }],
    ['a size without a second corner', { ...image, width: undefined }],
    [
      'a corner beyond the grid',
      { ...image, from: { row: 100_000, column: 0, x: 0, y: 0 } },
    ],
    ['an image key that is not a hash', { ...image, image: '../logo.png' }],
    ['unknown fields', { ...image, href: 'https://example.com' }],
  ])('rejects %s', (_, drawing) => {
    expect(validDrawings([drawing])).toBe(false);
  });

  it('rejects repeated ids', () => {
    expect(validDrawings([image, { ...chart, id: 'logo' }])).toBe(false);
  });

  it('stores raster images only', () => {
    expect(validImageUrl('data:image/jpeg;base64,/9j/4AAQ')).toBe(true);
    expect(validImageUrl('data:image/svg+xml;base64,PHN2Zy8+')).toBe(false);
    expect(validImageUrl('https://example.com/logo.png')).toBe(false);
  });

  it('parses chart references', () => {
    expect(parseChartReference("'Q1 ''24'!$B$2:$B$13")).toEqual({
      sheet: "Q1 '24",
      top: 1,
      bottom: 12,
      left: 1,
      right: 1,
    });
    expect(parseChartReference('Sheet1!C4')).toEqual({
      sheet: 'Sheet1',
      top: 3,
      bottom: 3,
      left: 2,
      right: 2,
    });
    // Reversed corners, and no sheet: the chart's own.
    expect(parseChartReference('$D$9:B2')).toEqual({
      sheet: undefined,
      top: 1,
      bottom: 8,
      left: 1,
      right: 3,
    });
    for (const reference of ['Revenue', 'A:A', 'Sheet1!A1,Sheet1!B1', 'A0'])
      expect(parseChartReference(reference)).toBeUndefined();
  });
});
