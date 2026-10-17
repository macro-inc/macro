import { type SheetTable, tableDataRows } from './sheet-tables';
import type { TableCellText } from './table-filters';

/** How a group by view summarizes a column, as Google Sheets offers. */
export const GROUP_SUMMARIES = [
  'sum',
  'average',
  'count',
  'filled',
  'empty',
  'unique',
  'min',
  'max',
  'percentFilled',
  'percentEmpty',
  'percentUnique',
] as const;
export type GroupSummary = (typeof GROUP_SUMMARIES)[number];

export const GROUP_SUMMARY_LABELS: Record<GroupSummary, string> = {
  sum: 'Sum',
  average: 'Average',
  count: 'Count',
  filled: 'Filled',
  empty: 'Empty',
  unique: 'Unique',
  min: 'Min',
  max: 'Max',
  percentFilled: 'Percent filled',
  percentEmpty: 'Percent empty',
  percentUnique: 'Percent unique',
};

/** Whether a summary is a share of the group's rows, shown as a percentage. */
export function percentSummary(summary: GroupSummary): boolean {
  return summary.startsWith('percent');
}

/**
 * A summary of cells. Sum, average, min and max read numbers and are
 * undefined without any; count is the number of rows.
 */
export function summarize(
  cells: TableCellText[],
  summary: GroupSummary
): number | undefined {
  const texts = cells.map((cell) => cell.text.trim());
  const filled = texts.filter(Boolean);
  const unique = new Set(filled.map((text) => text.toLowerCase())).size;
  const numbers = cells.flatMap((cell) =>
    cell.number === undefined ? [] : [cell.number]
  );
  const share = (count: number) => (cells.length ? count / cells.length : 0);
  switch (summary) {
    case 'count':
      return cells.length;
    case 'filled':
      return filled.length;
    case 'empty':
      return cells.length - filled.length;
    case 'unique':
      return unique;
    case 'percentFilled':
      return share(filled.length);
    case 'percentEmpty':
      return share(cells.length - filled.length);
    case 'percentUnique':
      return share(unique);
  }
  if (!numbers.length) return;
  switch (summary) {
    case 'sum':
      return numbers.reduce((total, value) => total + value, 0);
    case 'average':
      return (
        numbers.reduce((total, value) => total + value, 0) / numbers.length
      );
    case 'min':
      return Math.min(...numbers);
    case 'max':
      return Math.max(...numbers);
  }
}

/** The rows of a group by view: one value of the grouping column. */
export type TableGroup = { value: string; rows: number[] };

/**
 * A table's data rows grouped by a column's shown value, ignoring case, in
 * the order Google Sheets lists groups: numbers, then text, then blanks.
 * Rows in `hidden` are left out.
 */
export function groupTableRows(options: {
  table: SheetTable;
  column: number;
  read: (row: number, column: number) => TableCellText;
  hidden?: ReadonlySet<number>;
}): TableGroup[] {
  const { first, last } = tableDataRows(options.table);
  const groups = new Map<string, TableGroup & { number?: number }>();
  for (let row = first; row <= last; row++) {
    if (options.hidden?.has(row)) continue;
    const cell = options.read(row, options.column);
    const value = cell.text.trim();
    const key = value.toLowerCase();
    const group = groups.get(key);
    if (group) group.rows.push(row);
    else groups.set(key, { value, rows: [row], number: cell.number });
  }
  return [...groups.values()]
    .sort((a, b) => {
      if (!a.value || !b.value) return Number(!a.value) - Number(!b.value);
      if (a.number !== undefined && b.number !== undefined)
        return a.number - b.number;
      if (a.number !== undefined || b.number !== undefined)
        return a.number !== undefined ? -1 : 1;
      return a.value.localeCompare(b.value, 'en', {
        numeric: true,
        sensitivity: 'base',
      });
    })
    .map(({ value, rows }) => ({ value, rows }));
}
