import type { DatabaseColumnType } from './column-inference';
import { relatedRowIds } from './database-relations';
import type { DatabaseCellValue, DatabaseViewColumn } from './database-view';

export type DatabaseRow = {
  rowId: string;
  cells: Record<string, DatabaseCellValue>;
};

export type DatabaseRowMutation =
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

export function titleColumn(columns: readonly DatabaseViewColumn[]) {
  return columns.find(
    (column) =>
      column.dataType === 'STRING' && !column.isMultiSelect && !column.relation
  );
}

export function rowTitle(
  row: DatabaseRow,
  columns: readonly DatabaseViewColumn[]
) {
  const column = titleColumn(columns) ?? columns[0];
  const value = column ? rowValue(row, column.id) : null;
  if (value === null || value === '') return 'Unnamed';
  if (column?.relation) return formatCellValue(column, value) || 'Unnamed';
  return column?.dataType === 'ENTITY' ? 'Linked record' : String(value);
}

export function canEditCell(column: DatabaseViewColumn): boolean {
  if (column.relation) return column.writable;
  return (
    column.writable &&
    !column.isMultiSelect &&
    [
      'STRING',
      'NUMBER',
      'BOOLEAN',
      'DATE',
      'LINK',
      'SELECT_STRING',
      'SELECT_NUMBER',
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
  if (column.dataType === 'BOOLEAN') return value ? 'Yes' : 'No';
  if (column.isMultiSelect) {
    try {
      const values: unknown = JSON.parse(String(value));
      if (Array.isArray(values)) return values.map(String).join(', ');
    } catch {
      // Older / unknown values remain visible instead of disappearing.
    }
  }
  if (column.dataType === 'DATE') {
    const date = new Date(String(value));
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      });
    }
  }
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
      if (mutation.kind === 'create' || mutation.rowId !== row.rowId) continue;
      if (mutation.kind === 'delete') return [];
      cells = { ...cells, [mutation.columnId]: mutation.value };
    }
    return [{ ...row, cells }];
  });
}
