import { match } from 'ts-pattern';
import type { DatabaseCellValue } from './database-view';

export type ColumnCalculation =
  | 'none'
  | 'count'
  | 'unique'
  | 'sum'
  | 'average'
  | 'min'
  | 'max';

/** Summarize the records in view; empty cells never become numeric zeroes. */
export function summarizeColumn(
  values: DatabaseCellValue[],
  calculation: ColumnCalculation
): number | null {
  const filled = values.filter((value) => value !== null && value !== '');
  const numbers = filled.filter(
    (value): value is number =>
      typeof value === 'number' && Number.isFinite(value)
  );
  return match(calculation)
    .with('none', () => null)
    .with('count', () => filled.length)
    .with('unique', () => new Set(filled).size)
    .with('sum', () =>
      numbers.length ? numbers.reduce((sum, value) => sum + value, 0) : null
    )
    .with('average', () =>
      numbers.length
        ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length
        : null
    )
    .with('min', () =>
      numbers.length
        ? numbers.reduce((min, value) => Math.min(min, value))
        : null
    )
    .with('max', () =>
      numbers.length
        ? numbers.reduce((max, value) => Math.max(max, value))
        : null
    )
    .exhaustive();
}
