import { match } from 'ts-pattern';
import type { DatabaseCellValue, DatabaseViewColumn } from './database-view';

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

/** Monetary calculations keep each denomination separate, including averages. */
export function summarizeMoney(
  column: DatabaseViewColumn,
  rows: { cells: Record<string, DatabaseCellValue> }[],
  calculation: ColumnCalculation
): { currency: string; value: number }[] {
  const currencyColumn = column.currencyColumnId;
  if (!currencyColumn) return [];
  const groups = new Map<string, DatabaseCellValue[]>();
  for (const row of rows) {
    const value = row.cells[column.id] ?? null;
    if (value === null || value === '') continue;
    const currency = String(row.cells[currencyColumn] ?? 'USD');
    const values = groups.get(currency) ?? [];
    values.push(value);
    groups.set(currency, values);
  }
  return [...groups]
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([currency, values]) => {
      const value = summarizeColumn(values, calculation);
      return value === null ? [] : [{ currency, value }];
    });
}
