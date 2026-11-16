import { describe, expect, it } from 'vitest';
import { summarizeColumn, summarizeMoney } from './column-summary';

describe('column summaries', () => {
  it('counts filled and distinct values without counting empty cells', () => {
    const values = [null, '', 'Books', 'Books', 'Authors', 0];
    expect(summarizeColumn(values, 'count')).toBe(4);
    expect(summarizeColumn(values, 'unique')).toBe(3);
  });
  it('aggregates finite numbers without coercing blanks or text', () => {
    const values = [null, '', '100', 0, -2, 8, Infinity, NaN];
    expect(summarizeColumn(values, 'sum')).toBe(6);
    expect(summarizeColumn(values, 'average')).toBe(2);
    expect(summarizeColumn(values, 'min')).toBe(-2);
    expect(summarizeColumn(values, 'max')).toBe(8);
  });
  it('distinguishes no numeric values from a real zero total', () => {
    expect(summarizeColumn([], 'sum')).toBeNull();
    expect(summarizeColumn([null, ''], 'average')).toBeNull();
    expect(summarizeColumn([0], 'sum')).toBe(0);
    expect(summarizeColumn([], 'count')).toBe(0);
    expect(summarizeColumn([5], 'none')).toBeNull();
  });
});

it('keeps monetary sums and averages in their own currencies', () => {
  const column = {
    id: 'revenue',
    name: 'Revenue',
    dataType: 'NUMBER' as const,
    isMultiSelect: false,
    options: [],
    writable: true,
    currencyColumnId: 'currency',
  };
  const rows = [
    { cells: { revenue: 100, currency: 'USD' } },
    { cells: { revenue: 200, currency: 'EUR' } },
    { cells: { revenue: 50, currency: 'USD' } },
    { cells: { revenue: null, currency: 'JPY' } },
  ];
  expect(summarizeMoney(column, rows, 'sum')).toEqual([
    { currency: 'EUR', value: 200 },
    { currency: 'USD', value: 150 },
  ]);
  expect(summarizeMoney(column, rows, 'average')).toEqual([
    { currency: 'EUR', value: 200 },
    { currency: 'USD', value: 75 },
  ]);
});
