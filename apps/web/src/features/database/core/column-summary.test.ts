import { describe, expect, it } from 'vitest';
import { summarizeColumn } from './column-summary';

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
