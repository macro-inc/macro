/**
 * Grid edits as the typed ops of `POST /databases/{id}/ops`, from the grid's
 * own values (option labels, JSON-array strings for multi-valued cells).
 */

import { err, ok, Result } from 'neverthrow';
import { match } from 'ts-pattern';
import type {
  CellValue,
  CellWrite,
  DatabaseOp,
  OpEntityKind,
} from '../../../lib/core/database-sql/generated/types';
import { inferDatabaseNumber } from './column-inference';
import type { DatabaseCellValue, DatabaseViewColumn } from './database-view';
import { UNAVAILABLE_OPTION } from './grid-cells';
import type { DatabaseRowMutation } from './table';
import type { DatabaseCellFailure } from './write-failure';

const CLEAR: CellValue = { type: 'clear' };

/**
 * Cell values a multi-valued column holds, from the grid's JSON-array string.
 * Anything else is refused rather than read as no values, which would clear
 * the cell.
 */
function listedValues(
  value: DatabaseCellValue
): Result<string[], DatabaseCellFailure> {
  if (value === null || value === '') return ok([]);
  if (typeof value !== 'string') return err({ kind: 'malformed-list' });
  const parsed = Result.fromThrowable(
    (text: string): unknown => JSON.parse(text),
    (): DatabaseCellFailure => ({ kind: 'malformed-list' })
  )(value);
  return parsed.andThen(
    (list): Result<string[], DatabaseCellFailure> =>
      Array.isArray(list) &&
      list.every((item) => typeof item === 'string' || typeof item === 'number')
        ? ok(list.map(String))
        : err({ kind: 'malformed-list' })
  );
}

/** The kind of entity an entity column's references point at. */
function referenceKind(
  column: DatabaseViewColumn
): Result<OpEntityKind, DatabaseCellFailure> {
  const target = column.specificEntityType;
  if (target == null) return err({ kind: 'untyped-entity' });
  if (target === 'DATABASE_ROW') return err({ kind: 'relation-as-entity' });
  return ok(target);
}

/** Options named by label; one the grid could not name is refused. */
function optionLabels(
  labels: string[]
): Result<CellValue, DatabaseCellFailure> {
  return labels.includes(UNAVAILABLE_OPTION)
    ? err({ kind: 'unavailable-option' })
    : ok({ type: 'options', value: labels.map((label) => ({ label })) });
}

/** A calendar day or an instant, as the instant a date cell stores. */
function instant(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value;
}

/**
 * A grid value as the value a column's cell takes. An empty value clears
 * any cell but a text one, which keeps the empty text.
 */
export function cellValue(
  column: DatabaseViewColumn,
  value: DatabaseCellValue
): Result<CellValue, DatabaseCellFailure> {
  const definition = column;
  if (column.relation)
    return listedValues(value).map(
      (rows): CellValue =>
        rows.length ? { type: 'rows', value: [...new Set(rows)] } : CLEAR
    );
  if (definition.isMultiSelect)
    return listedValues(value).andThen(
      (values): Result<CellValue, DatabaseCellFailure> => {
        if (!values.length) return ok(CLEAR);
        return definition.dataType === 'ENTITY'
          ? referenceKind(column).map((entityType) => ({
              type: 'entities',
              value: values.map((entityId) => ({ entityType, entityId })),
            }))
          : optionLabels(values);
      }
    );
  if (value === null) return ok(CLEAR);
  if (value === '' && definition.dataType !== 'STRING') return ok(CLEAR);
  return match(definition.dataType)
    .returnType<Result<CellValue, DatabaseCellFailure>>()
    .with('STRING', () => ok({ type: 'text', value: String(value) }))
    .with('NUMBER', () => {
      const number =
        typeof value === 'number' ? value : inferDatabaseNumber(value);
      return number !== undefined && Number.isFinite(number)
        ? ok({ type: 'number', value: number })
        : err({ kind: 'not-a-number' });
    })
    .with('BOOLEAN', () =>
      ok({
        type: 'boolean',
        value:
          typeof value === 'number'
            ? value !== 0
            : ['1', 'true'].includes(value.toLowerCase()),
      })
    )
    .with('DATE', () => ok({ type: 'date', value: instant(String(value)) }))
    .with('LINK', () => ok({ type: 'link', value: [String(value)] }))
    .with('SELECT_STRING', 'SELECT_NUMBER', 'TAG', () =>
      optionLabels([String(value)])
    )
    .with('ENTITY', () =>
      referenceKind(column).map((entityType) => ({
        type: 'entities',
        value: [{ entityType, entityId: String(value) }],
      }))
    )
    .exhaustive();
}

/**
 * The one op a grid edit is. `columnFor` answers the writable column a
 * value goes to.
 */
export function mutationOp(
  tableId: string,
  mutation: DatabaseRowMutation,
  columnFor: (
    columnId: string
  ) => Result<DatabaseViewColumn, DatabaseCellFailure>
): Result<DatabaseOp, DatabaseCellFailure> {
  const cell = (columnId: string, value: DatabaseCellValue) =>
    columnFor(columnId)
      .andThen((column) => cellValue(column, value))
      .map((written): CellWrite => ({ column: columnId, value: written }));
  return match(mutation)
    .returnType<Result<DatabaseOp, DatabaseCellFailure>>()
    .with({ kind: 'clear' }, ({ rowIds, columnIds }) =>
      Result.combine(columnIds.map((id) => cell(id, null))).map((cells) => ({
        kind: 'rows',
        table: tableId,
        change: {
          kind: 'update',
          changes: { kind: 'uniform', rows: rowIds, cells },
        },
      }))
    )
    .with({ kind: 'cell' }, ({ rowId, columnId, value }) =>
      cell(columnId, value).map((written) => ({
        kind: 'rows',
        table: tableId,
        change: {
          kind: 'update',
          changes: {
            kind: 'per_row',
            rows: [{ row: rowId, cells: [written] }],
          },
        },
      }))
    )
    .with({ kind: 'create' }, ({ values }) =>
      Result.combine(
        Object.entries(values).map(([columnId, value]) => cell(columnId, value))
      ).map((cells) => ({
        kind: 'rows',
        table: tableId,
        change: { kind: 'insert', rows: [cells] },
      }))
    )
    .with({ kind: 'delete' }, ({ rowId }) =>
      ok({
        kind: 'rows',
        table: tableId,
        change: { kind: 'delete', rows: [rowId] },
      })
    )
    .exhaustive();
}

/**
 * The labels a write names options by that its columns lack, per column:
 * what an `add_options` column op ahead of it must create, since an unknown label
 * refuses the write. `labelsOf` answers a column's own option labels.
 */
export function missingOptionLabels(
  op: DatabaseOp,
  labelsOf: (columnId: string) => readonly string[]
): { column: string; labels: string[] }[] {
  const cells = match(op)
    .returnType<CellWrite[]>()
    .with({ kind: 'rows', change: { kind: 'insert' } }, ({ change }) =>
      change.rows.flat()
    )
    .with(
      {
        kind: 'rows',
        change: { kind: 'update', changes: { kind: 'uniform' } },
      },
      ({ change }) => change.changes.cells
    )
    .with(
      {
        kind: 'rows',
        change: { kind: 'update', changes: { kind: 'per_row' } },
      },
      ({ change }) => change.changes.rows.flatMap((row) => row.cells)
    )
    .otherwise(() => []);
  const missing = new Map<string, Map<string, string>>();
  for (const cell of cells) {
    if (cell.value.type !== 'options') continue;
    const known = new Set(
      labelsOf(cell.column).map((label) => label.toLowerCase())
    );
    const labels = missing.get(cell.column) ?? new Map<string, string>();
    for (const option of cell.value.value) {
      const label = option.label;
      if (label === undefined || known.has(label.toLowerCase())) continue;
      if (!labels.has(label.toLowerCase()))
        labels.set(label.toLowerCase(), label);
    }
    if (labels.size) missing.set(cell.column, labels);
  }
  return [...missing].map(([column, labels]) => ({
    column,
    labels: [...labels.values()],
  }));
}
