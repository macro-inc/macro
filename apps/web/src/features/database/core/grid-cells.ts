/**
 * The engine's cells as the grid's editing values: option labels, ids, a
 * checkbox as 0 or 1, and a JSON array for a multi-valued cell.
 */

import type { ColumnDetail } from '@service-storage/generated/schemas/columnDetail';
import { match } from 'ts-pattern';
import type {
  Catalog,
  Cell,
  ColumnKind,
  Outcome,
} from '../../../lib/core/database-sql/generated/types';
import type { DatabaseCellValue } from './database-view';
import type { DatabaseRow } from './table';

/**
 * What a cell shows for an option its column's catalog lacks, as relations
 * show an unavailable record. A write carrying it is refused, so it never
 * becomes an option of its own.
 */
export const UNAVAILABLE_OPTION = 'Unavailable option';

function listed(values: string[], multi: boolean): DatabaseCellValue {
  return multi ? JSON.stringify(values) : (values[0] ?? null);
}

function gridValue(
  cell: Cell | null,
  kind: ColumnKind | undefined
): DatabaseCellValue {
  if (!cell) return null;
  const multi =
    (kind?.kind === 'select' || kind?.kind === 'entity') && kind.multi;
  return match(cell)
    .returnType<DatabaseCellValue>()
    .with({ type: 'text' }, ({ value }) => value)
    .with({ type: 'number' }, ({ value }) => value)
    .with({ type: 'bool' }, ({ value }) => (value ? 1 : 0))
    .with({ type: 'date' }, ({ value }) => value)
    .with({ type: 'options' }, ({ value }) =>
      listed(
        value.map((id) =>
          kind?.kind === 'select'
            ? (kind.options.find((option) => option.id === id)?.label ??
              UNAVAILABLE_OPTION)
            : UNAVAILABLE_OPTION
        ),
        multi
      )
    )
    .with({ type: 'entities' }, ({ value }) => listed(value, multi))
    .with({ type: 'row' }, ({ value }) => value)
    .exhaustive();
}

/** A row-shaped outcome's rows, with a cell for each of the table's columns. */
export function gridRows(
  outcome: Outcome,
  catalog: Catalog,
  columns: readonly ColumnDetail[]
): DatabaseRow[] {
  const catalogColumns = new Map(
    catalog.tables.flatMap((table) =>
      table.columns.map((column) => [column.id, column] as const)
    )
  );
  const placed = columns.map((column) => {
    const definition = column.definition.definition.id;
    return {
      id: column.column.id,
      index: outcome.columns.findIndex(
        (candidate) => candidate.column === definition
      ),
      kind: catalogColumns.get(definition)?.kind,
    };
  });
  return outcome.rowIds.map((rowId, rowIndex) => ({
    rowId,
    cells: Object.fromEntries(
      placed.map(({ id, index, kind }) => [
        id,
        gridValue(outcome.rows[rowIndex]?.[index] ?? null, kind),
      ])
    ),
  }));
}

/** `next`, with each row whose cells read exactly as in `previous` kept as that row. */
export function keepUnchangedRows(
  previous: readonly DatabaseRow[],
  next: DatabaseRow[]
): DatabaseRow[] {
  const shown = new Map(previous.map((row) => [row.rowId, row]));
  return next.map((row) => {
    const before = shown.get(row.rowId);
    return before && sameCells(before.cells, row.cells) ? before : row;
  });
}

function sameCells(
  left: DatabaseRow['cells'],
  right: DatabaseRow['cells']
): boolean {
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => key in right && left[key] === right[key])
  );
}
