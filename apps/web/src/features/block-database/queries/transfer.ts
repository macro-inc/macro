import { databaseSqlSchema } from '@core/database-sql/catalog';
import type { DatabaseSqlFailure } from '@core/database-sql/driver';
import type { ResultError } from '@core/util/result';
import { readDatabaseSql } from '@queries/database-sql/create-database-sql-query';
import { invalidateDatabase } from '@queries/storage/databases';
import { storageServiceClient } from '@service-storage/client';
import type { DatabaseSchemaErrorCode } from '@service-storage/databases';
import type { DatabaseDetail } from '@service-storage/generated/schemas/databaseDetail';
import type { ImportTable } from '@service-storage/generated/schemas/importTable';
import type { Table } from '@service-storage/generated/schemas/table';
import type { TableDetail } from '@service-storage/generated/schemas/tableDetail';
import { err, ok, type ResultAsync } from 'neverthrow';
import { encodeDatabaseCsv } from '../../database/core/csv';
import { relatedRowIds } from '../../database/core/database-relations';
import type {
  DatabaseCellValue,
  DatabaseViewColumn,
} from '../../database/core/database-view';
import { gridRows } from '../../database/core/grid-cells';
import { formatCellValue } from '../../database/core/table';
import { tableRowsStatement } from '../sql';
import { toViewColumn } from './table-rows';

/** Request IDs survive a transport error; retrying resolves the original import. */
export function importDatabaseTable(
  databaseId: string,
  request: ImportTable
): ResultAsync<Table, ResultError<DatabaseSchemaErrorCode>[]> {
  return storageServiceClient.databases
    .importTable({ id: databaseId, request })
    .map(async (table) => {
      await invalidateDatabase(databaseId);
      return table;
    });
}

/** The table's rows could not be read, or not all of them. */
type DatabaseExportFailure = DatabaseSqlFailure | { kind: 'too-large' };

/**
 * A cell as the CSV carries it: what the grid shows, except where its display
 * drops data. Dates keep their stored moment (the grid shows the day) and
 * numbers every digit (the grid rounds). Relation cells have no row names
 * loaded here, so they keep the related rows' ids rather than claiming those
 * rows are unavailable.
 */
export function exportedValue(
  column: DatabaseViewColumn,
  value: DatabaseCellValue
): string {
  if (column.relation) return relatedRowIds(value).join(', ');
  if (column.dataType === 'DATE' && typeof value === 'string') return value;
  if (column.dataType === 'NUMBER' && typeof value === 'number')
    return String(value);
  return formatCellValue(column, value);
}

/** Never silently export a partial read. */
export function exportDatabaseTableCsv(
  database: DatabaseDetail,
  table: TableDetail
): ResultAsync<Blob, DatabaseExportFailure> {
  const { columns } = table;
  const viewColumns = columns.map(toViewColumn);
  return readDatabaseSql({
    schema: databaseSqlSchema([{ ...database, tables: [table] }]),
    scope: database.database.id,
    sql: tableRowsStatement(table.sql_name),
  }).andThen(({ catalog, outcome }) => {
    if (outcome.truncated) return err({ kind: 'too-large' as const });
    const rows = gridRows(outcome, catalog, columns).map((row) =>
      viewColumns.map((column) =>
        exportedValue(column, row.cells[column.id] ?? null)
      )
    );
    return ok(
      new Blob(
        [
          encodeDatabaseCsv(
            viewColumns.map((column) => column.name),
            rows
          ),
        ],
        { type: 'text/csv;charset=utf-8' }
      )
    );
  });
}
