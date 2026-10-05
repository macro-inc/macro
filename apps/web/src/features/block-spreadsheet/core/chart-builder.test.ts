import { describe, expect, it } from 'vitest';
import {
  chartFromLayout,
  chartLayout,
  chartType,
  dataRegion,
  guessLayout,
  withChartType,
} from './chart-builder';
import { formatCellAddress } from './spreadsheet-document';

/** A sheet as rows of cells from A1; numbers are numbers. */
function sheet(rows: (string | number | undefined)[][]) {
  const cells = new Map<string, string | number>();
  rows.forEach((row, rowIndex) =>
    row.forEach((value, column) => {
      if (value !== undefined && value !== '')
        cells.set(formatCellAddress(rowIndex, column), value);
    })
  );
  return {
    filled: (row: number, column: number) =>
      cells.has(formatCellAddress(row, column)),
    value: (row: number, column: number) => {
      const value = cells.get(formatCellAddress(row, column));
      if (value === undefined) return;
      return typeof value === 'number'
        ? { text: String(value), number: value }
        : { text: value };
    },
  };
}

const limits = { rows: 100, columns: 26 };

describe('charts of cells', () => {
  const sales = sheet([
    ['Month', 'Revenue', 'Costs'],
    ['Jan', 1000, 700],
    ['Feb', 1250, 820],
    ['Mar', 1500, 940],
    [],
    ['Note: unaudited'],
  ]);

  it('charts the table around a cell, as Excel does', () => {
    const region = dataRegion(
      sales.filled,
      { top: 2, left: 1, bottom: 2, right: 1 },
      limits
    );
    expect(region).toEqual({ top: 0, left: 0, bottom: 3, right: 2 });
    // Nothing nearby: nothing to chart.
    expect(
      dataRegion(
        sales.filled,
        { top: 20, left: 10, bottom: 20, right: 10 },
        limits
      )
    ).toBeUndefined();
    // A selection is charted as it is.
    expect(
      dataRegion(sales.filled, { top: 0, left: 0, bottom: 3, right: 1 }, limits)
    ).toEqual({ top: 0, left: 0, bottom: 3, right: 1 });
  });

  it('reads names, labels and the series direction', () => {
    const range = { top: 0, left: 0, bottom: 3, right: 2 };
    expect(guessLayout(range, sales.value)).toEqual({
      range,
      orientation: 'columns',
      firstRow: true,
      firstColumn: true,
    });
    // Wider than tall: each row is a series.
    const wide = sheet([
      ['', 'Q1', 'Q2', 'Q3', 'Q4'],
      ['North', 1, 2, 3, 4],
      ['South', 5, 6, 7, 8],
    ]);
    expect(
      guessLayout({ top: 0, left: 0, bottom: 2, right: 4 }, wide.value)
    ).toMatchObject({ orientation: 'rows', firstRow: true, firstColumn: true });
    // Numbers only: no names or labels.
    const numbers = sheet([[1], [2], [3]]);
    expect(
      guessLayout({ top: 0, left: 0, bottom: 2, right: 0 }, numbers.value)
    ).toMatchObject({ firstRow: false, firstColumn: false });
  });

  it('builds a chart of each series with its name and labels', () => {
    const chart = chartFromLayout('column-stacked', 'Q1 Sales', {
      range: { top: 0, left: 0, bottom: 3, right: 2 },
      orientation: 'columns',
      firstRow: true,
      firstColumn: true,
    });
    expect(chart).toEqual({
      legend: 'bottom',
      plots: [
        {
          kind: 'column',
          grouping: 'stacked',
          series: [
            { nameRef: 0, categories: 1, values: 2 },
            { nameRef: 3, categories: 4, values: 5 },
          ],
        },
      ],
      references: [
        "'Q1 Sales'!$B$1",
        "'Q1 Sales'!$A$2:$A$4",
        "'Q1 Sales'!$B$2:$B$4",
        "'Q1 Sales'!$C$1",
        "'Q1 Sales'!$A$2:$A$4",
        "'Q1 Sales'!$C$2:$C$4",
      ],
    });
    expect(chartType(chart!)).toBe('column-stacked');
    // A pie shows the first series; rows make series of rows.
    const pie = chartFromLayout('pie', 'Q1 Sales', {
      range: { top: 0, left: 0, bottom: 2, right: 4 },
      orientation: 'rows',
      firstRow: true,
      firstColumn: true,
    });
    expect(pie?.plots[0].series).toEqual([
      { nameRef: 0, categories: 1, values: 2 },
    ]);
    expect(pie?.references).toEqual([
      "'Q1 Sales'!$A$2",
      "'Q1 Sales'!$B$1:$E$1",
      "'Q1 Sales'!$B$2:$E$2",
    ]);
    // Only names and labels: nothing to chart.
    expect(
      chartFromLayout('line', 'Sheet1', {
        range: { top: 0, left: 0, bottom: 0, right: 2 },
        orientation: 'columns',
        firstRow: true,
        firstColumn: false,
      })
    ).toBeUndefined();
  });

  it('finds the cells and reading of a chart, and changes its type', () => {
    const layout = {
      range: { top: 0, left: 0, bottom: 3, right: 2 },
      orientation: 'columns' as const,
      firstRow: true,
      firstColumn: true,
    };
    const chart = chartFromLayout('line', 'Sales', layout)!;
    expect(chartLayout(chart, 'Sales')).toEqual({ sheet: 'Sales', layout });
    // Ranges on several sheets are not one block.
    expect(
      chartLayout(
        { ...chart, references: [...chart.references.slice(1), 'Other!A1'] },
        'Sales'
      )
    ).toBeUndefined();
    const pie = withChartType(chart, 'pie');
    expect(pie.plots).toEqual([
      { kind: 'pie', series: [chart.plots[0].series[0]] },
    ]);
    expect(chartType(withChartType(chart, 'bar-stacked'))).toBe('bar-stacked');
  });
});
