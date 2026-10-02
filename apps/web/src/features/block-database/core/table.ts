import { markdownToPlainText } from '@macro-inc/lexical-core/utils/parsers';
import {
  formatBoolean,
  formatDate,
  formatNumber,
} from '@property/utils/formatting';
import { fromCellDate } from './cell-date';
import type { DatabaseColumnType } from './column-inference';
import { relatedRowIds } from './database-relations';
import {
  type DatabaseCellValue,
  type DatabaseViewColumn,
  isOptionColumn,
} from './database-view';

export type DatabaseRow = {
  rowId: string;
  cells: Record<string, DatabaseCellValue>;
};

export type DatabaseRowMutation =
  | { kind: 'clear'; rowIds: string[]; columnIds: string[] }
  | {
      kind: 'cell';
      rowId: string;
      columnId: string;
      value: DatabaseCellValue;
      columnTypes?: Record<string, DatabaseColumnType>;
    }
  | {
      kind: 'create';
      values: Record<string, DatabaseCellValue>;
      columnTypes?: Record<string, DatabaseColumnType>;
    }
  | { kind: 'delete'; rowId: string };

export function rowValue(
  row: DatabaseRow,
  columnId: string
): DatabaseCellValue {
  return row.cells[columnId] ?? null;
}

/** The column a row is named by outside a board: the table's first. */
export function titleColumn(columns: readonly DatabaseViewColumn[]) {
  return columns[0];
}

/** A row's name as `column` holds it, or `Unnamed` when it holds nothing. */
export function cellTitle(
  row: DatabaseRow,
  column: DatabaseViewColumn | undefined
) {
  if (!column) return 'Unnamed';
  const value = rowValue(row, column.id);
  if (value === null || value === '') return 'Unnamed';
  if (column.dataType === 'ENTITY' && !column.relation) return 'Linked record';
  return formatCellValue(column, value) || 'Unnamed';
}

export function rowTitle(
  row: DatabaseRow,
  columns: readonly DatabaseViewColumn[]
) {
  return cellTitle(row, titleColumn(columns));
}

/** Whether a typed title can be written into `column` as it is. */
export function isWritableText(
  column: DatabaseViewColumn | undefined
): column is DatabaseViewColumn {
  return (
    !!column?.writable &&
    column.dataType === 'STRING' &&
    !column.isMultiSelect &&
    !column.relation
  );
}

export function canEditCell(column: DatabaseViewColumn): boolean {
  if (column.relation) return column.writable;
  return (
    column.writable &&
    (!column.isMultiSelect || isOptionColumn(column)) &&
    [
      'STRING',
      'NUMBER',
      'BOOLEAN',
      'DATE',
      'LINK',
      'SELECT_STRING',
      'SELECT_NUMBER',
      'TAG',
      'ENTITY',
    ].includes(column.dataType)
  );
}

export function formatCellValue(
  column: DatabaseViewColumn,
  value: DatabaseCellValue
): string {
  if (value === null || value === '') return '';
  if (column.relation)
    return relatedRowIds(value)
      .map((id) => column.relation?.labels?.[id] ?? 'Unavailable record')
      .join(', ');
  if (column.dataType === 'BOOLEAN') return formatBoolean(Boolean(value));
  if (column.isMultiSelect) {
    try {
      const values: unknown = JSON.parse(String(value));
      if (Array.isArray(values)) return values.map(String).join(', ');
    } catch {
      // Not a JSON array: shown as the one value it is.
    }
  }
  if (column.dataType === 'STRING') return markdownToPlainText(String(value));
  if (column.dataType === 'DATE') {
    const date = fromCellDate(value);
    if (date) return formatDate(date);
  }
  if (column.dataType === 'NUMBER' && typeof value === 'number')
    return formatNumber(value);
  return String(value);
}

/** Transient cell edits are projected until their write and refresh complete. */
export function optimisticRows(
  rows: readonly DatabaseRow[],
  mutations: readonly DatabaseRowMutation[]
): DatabaseRow[] {
  return rows.flatMap((row) => {
    let cells = row.cells;
    for (const mutation of mutations) {
      if (mutation.kind === 'clear') {
        if (mutation.rowIds.includes(row.rowId))
          cells = {
            ...cells,
            ...Object.fromEntries(mutation.columnIds.map((id) => [id, null])),
          };
        continue;
      }
      if (mutation.kind === 'create' || mutation.rowId !== row.rowId) continue;
      if (mutation.kind === 'delete') return [];
      cells = { ...cells, [mutation.columnId]: mutation.value };
    }
    // An untouched row stays the same object, so the grid leaves it alone.
    return [cells === row.cells ? row : { ...row, cells }];
  });
}
