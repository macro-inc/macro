import { expect, it } from 'vitest';
import { fromCellDate, toCellDate } from './cell-date';

it('stores the picked local day as UTC midnight', () => {
  expect(toCellDate(new Date(2025, 11, 31, 23, 30))).toBe(
    '2025-12-31T00:00:00.000Z'
  );
});

it('reads the stored day back as that local calendar day', () => {
  const date = fromCellDate('2025-07-19T00:00:00.000Z');
  expect([date?.getFullYear(), date?.getMonth(), date?.getDate()]).toEqual([
    2025, 6, 19,
  ]);
  expect(fromCellDate(null)).toBeNull();
  expect(fromCellDate('not a date')).toBeNull();
});
