import type {
  Catalog,
  Cell,
  ColumnKind,
  DatabaseView,
  Outcome,
} from '@core/database-sql/generated/types';
import { match } from 'ts-pattern';
import type { DatabaseTableSchema } from './api';
import { cellValue } from './cell-ops';
import type { DatabaseViewColumn } from './database-view';
import type { DatabaseRow } from './table';
import type { DatabaseViewState } from './view-state';

function kind(column: DatabaseViewColumn): ColumnKind {
  if (column.relation)
    return { kind: 'entity', multi: true, target: 'DATABASE_ROW' };
  return match(column.dataType)
    .returnType<ColumnKind>()
    .with('STRING', () => ({ kind: 'text' }))
    .with('NUMBER', () => ({ kind: 'number' }))
    .with('BOOLEAN', () => ({ kind: 'boolean' }))
    .with('DATE', () => ({ kind: 'date' }))
    .with('LINK', () => ({ kind: 'link' }))
    .with('SELECT_STRING', 'SELECT_NUMBER', 'TAG', () => ({
      kind: 'select',
      multi: column.isMultiSelect,
      options: column.options,
    }))
    .with('ENTITY', () =>
      column.specificEntityType
        ? {
            kind: 'entity',
            multi: column.isMultiSelect,
            target: column.specificEntityType,
          }
        : { kind: 'text' }
    )
    .exhaustive();
}

function cell(column: DatabaseViewColumn, row: DatabaseRow): Cell | null {
  const value = cellValue(column, row.cells[column.id] ?? null);
  if (value.isErr()) return null;
  return match(value.value)
    .returnType<Cell | null>()
    .with({ type: 'clear' }, () => null)
    .with(
      { type: 'text' },
      { type: 'number' },
      { type: 'date' },
      (cell) => cell
    )
    .with({ type: 'boolean' }, ({ value }) => ({ type: 'bool', value }))
    .with({ type: 'link' }, ({ value }) => ({
      type: 'text',
      value: value[0] ?? '',
    }))
    .with({ type: 'entities' }, ({ value }) => ({
      type: 'entities',
      value: value.map((ref) => ref.entityId),
    }))
    .with({ type: 'rows' }, ({ value }) => ({ type: 'entities', value }))
    .with({ type: 'options' }, ({ value }) => ({
      type: 'options',
      value: value.flatMap((ref) => {
        const id =
          'id' in ref
            ? ref.id
            : column.options.find((option) => option.label === ref.label)?.id;
        return id ? [id] : [];
      }),
    }))
    .exhaustive();
}

/** Adapt normalized API rows to the existing board layout engine; no SQL query is needed. */
export function boardInput(
  table: DatabaseTableSchema,
  rows: DatabaseRow[],
  state: DatabaseViewState
): {
  catalog: Catalog;
  outcome: Outcome;
  view: DatabaseView;
} {
  const columns = table.columns.map((column) => ({
    id: column.id,
    placement: column.id,
    name: column.name,
    kind: kind(column),
  }));
  return {
    catalog: {
      tables: [
        {
          id: table.id,
          databaseId: table.databaseId,
          database: '',
          name: table.name,
          columns,
        },
      ],
    },
    outcome: {
      columns: columns.map((column) => ({
        name: column.name,
        column: column.id,
        kind: column.kind.kind === 'link' ? 'text' : column.kind.kind,
      })),
      rows: rows.map((row) => table.columns.map((column) => cell(column, row))),
      rowIds: rows.map((row) => row.rowId),
      readTables: [table.id],
      truncated: false,
      insertedRowIds: [],
      changesApplied: 0,
    },
    view: {
      id: table.id,
      databaseId: table.databaseId,
      tableId: table.id,
      name: '',
      position: '80',
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      ...state,
    },
  };
}
