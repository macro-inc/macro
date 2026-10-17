import {
  findTable,
  keepsHiddenRow,
  replaceTable,
  type SheetTable,
  type TableColumnFilter,
  type TableFilterCondition,
  tableBounds,
  tableDataRows,
} from './sheet-tables';
import { typedNumber } from './typed-number';
import type { WorkbookSheetMetadata } from './workbook-metadata';

/** What a filter tests in a cell: its displayed text, and its number when
 * it holds one. */
export type TableCellText = { text: string; number?: number };

/** Whether a cell meets a condition. Numeric conditions compare numbers,
 * dates and times, typed as the condition's value; a cell or value that is
 * not a number never meets them, except that `equal` and `notEqual` then
 * compare text. */
export function conditionMatches(
  condition: TableFilterCondition,
  cell: TableCellText
): boolean {
  const text = cell.text.trim().toLowerCase();
  const value = (condition.value ?? '').trim();
  const needle = value.toLowerCase();
  switch (condition.operator) {
    case 'empty':
      return text === '';
    case 'notEmpty':
      return text !== '';
    case 'contains':
      return text.includes(needle);
    case 'notContains':
      return !text.includes(needle);
    case 'startsWith':
      return text.startsWith(needle);
    case 'endsWith':
      return text.endsWith(needle);
    case 'textEquals':
      return text === needle;
  }
  const number = cell.number ?? (text ? typedNumber(text) : undefined);
  const first = typedNumber(value);
  if (number === undefined || first === undefined) {
    if (condition.operator === 'equal') return text === needle;
    if (condition.operator === 'notEqual') return text !== needle;
    return false;
  }
  const second = typedNumber(condition.value2 ?? '');
  const low = Math.min(first, second ?? first);
  const high = Math.max(first, second ?? first);
  switch (condition.operator) {
    case 'equal':
      return number === first;
    case 'notEqual':
      return number !== first;
    case 'greaterThan':
      return number > first;
    case 'greaterThanOrEqual':
      return number >= first;
    case 'lessThan':
      return number < first;
    case 'lessThanOrEqual':
      return number <= first;
    case 'between':
      return second !== undefined && number >= low && number <= high;
    case 'notBetween':
      return second !== undefined && (number < low || number > high);
  }
}

/** A test of whether a column's filter shows a cell. */
export function columnFilterTest(
  filter: TableColumnFilter
): (cell: TableCellText) => boolean {
  const values =
    filter.values && new Set(filter.values.map((value) => value.toLowerCase()));
  return (cell) => {
    const text = cell.text.trim();
    if (
      values &&
      (text === '' ? !filter.blanks : !values.has(text.toLowerCase()))
    )
      return false;
    return !filter.condition || conditionMatches(filter.condition, cell);
  };
}

/** The data rows a table's filters hide, given each cell's value. */
export function tableFilterHiddenRows(
  table: SheetTable,
  read: (row: number, column: number) => TableCellText
): number[] {
  const filters = Object.entries(table.filters ?? {}).map(
    ([offset, filter]) => ({
      column: tableBounds(table).left + Number(offset),
      shows: columnFilterTest(filter),
    })
  );
  if (!filters.length) return [];
  const { first, last } = tableDataRows(table);
  const hidden: number[] = [];
  for (let row = first; row <= last; row++)
    if (filters.some(({ column, shows }) => !shows(read(row, column))))
      hidden.push(row);
  return hidden;
}

/**
 * Set a table's filters and hide the data rows they leave out. Rows of the
 * table's data the filters keep are shown again, unless another table's
 * filter may hide them.
 */
export function filterTable(options: {
  metadata: WorkbookSheetMetadata | undefined;
  name: string;
  filters: SheetTable['filters'];
  read: (row: number, column: number) => TableCellText;
}): WorkbookSheetMetadata {
  const table = findTable(options.metadata, options.name);
  const filters = Object.keys(options.filters ?? {}).length
    ? options.filters
    : undefined;
  const filtered: SheetTable = { ...table, filters };
  if (!filters) delete filtered.filters;
  const hidden = new Set(
    (options.metadata?.hiddenRows ?? []).filter(
      keepsHiddenRow(options.metadata, table.name)
    )
  );
  for (const row of tableFilterHiddenRows(filtered, options.read))
    hidden.add(row);
  const metadata = replaceTable(
    options.metadata ?? {},
    table.name,
    () => filtered
  );
  const { hiddenRows: _hidden, ...rest } = metadata;
  return hidden.size
    ? { ...rest, hiddenRows: [...hidden].sort((a, b) => a - b) }
    : rest;
}

/** Text describing a column's filter, such as `Greater than 5`. */
export function filterSummary(filter: TableColumnFilter): string {
  const parts: string[] = [];
  if (filter.values) {
    const count = filter.values.length + (filter.blanks ? 1 : 0);
    parts.push(`${count} value${count === 1 ? '' : 's'}`);
  }
  if (filter.condition) {
    const { operator, value = '', value2 = '' } = filter.condition;
    parts.push(
      `${TABLE_FILTER_LABELS[operator]}${operator === 'empty' || operator === 'notEmpty' ? '' : ` ${value}`}${operator === 'between' || operator === 'notBetween' ? ` and ${value2}` : ''}`
    );
  }
  return parts.join(', ');
}

/** Each condition's label, as menus show it. */
export const TABLE_FILTER_LABELS: Record<
  TableFilterCondition['operator'],
  string
> = {
  empty: 'Is empty',
  notEmpty: 'Is not empty',
  contains: 'Text contains',
  notContains: 'Text does not contain',
  startsWith: 'Text starts with',
  endsWith: 'Text ends with',
  textEquals: 'Text is exactly',
  equal: 'Is equal to',
  notEqual: 'Is not equal to',
  greaterThan: 'Greater than',
  greaterThanOrEqual: 'Greater than or equal to',
  lessThan: 'Less than',
  lessThanOrEqual: 'Less than or equal to',
  between: 'Is between',
  notBetween: 'Is not between',
};
