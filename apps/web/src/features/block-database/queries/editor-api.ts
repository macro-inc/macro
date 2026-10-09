import { databaseSqlSchema } from '@core/database-sql/catalog';
import { readDatabaseSql } from '@queries/database-sql/create-database-sql-query';
import {
  applyDatabaseOps,
  databaseDetailQueryOptions,
} from '@queries/storage/databases';
import type { TableDetail } from '@service-storage/generated/schemas/tableDetail';
import type { QueryClient } from '@tanstack/solid-query';
import { err, errAsync, ok, ResultAsync } from 'neverthrow';
import type {
  DatabaseApi,
  DatabaseRowPage,
  DatabaseTableSchema,
} from '../../database/core/api';
import { gridRows } from '../../database/core/grid-cells';
import { allRecordsView } from '../../database/core/views';
import type { DatabaseReadFailure } from '../../database/core/write-failure';
import { rowsByIdStatement } from '../sql';
import { toViewColumn } from './table-rows';

export function editorTable(table: TableDetail): DatabaseTableSchema {
  return {
    id: table.table.id,
    databaseId: table.table.database_id,
    name: table.table.name,
    version: table.table.version,
    columns: table.columns.map(toViewColumn),
  };
}

/** The Macro app's implementation of the same API an embedded host supplies. */
export function createMacroDatabaseApi(
  databaseId: string,
  client: QueryClient
): DatabaseApi {
  const detail = () =>
    ResultAsync.fromPromise(
      client.fetchQuery(databaseDetailQueryOptions(databaseId)),
      (): DatabaseReadFailure => ({
        kind: 'fetch',
        message: 'Could not load the database schema.',
      })
    );
  return {
    key: ['macro-database', databaseId],
    readTable: (id) =>
      detail().andThen((detail) => {
        const table = detail.tables.find((table) => table.table.id === id);
        return table
          ? ok(editorTable(table))
          : err({ kind: 'table-unavailable' as const });
      }),
    readRows: (request) =>
      detail().andThen(
        (detail): ResultAsync<DatabaseRowPage, DatabaseReadFailure> => {
          const table = detail.tables.find(
            (table) => table.table.id === request.tableId
          );
          if (!table) return errAsync({ kind: 'table-unavailable' });
          return readDatabaseSql({
            schema: databaseSqlSchema([{ ...detail, tables: [table] }]),
            scope: databaseId,
            ...(request.rowIds
              ? { sql: rowsByIdStatement(table.sql_name, request.rowIds) }
              : {
                  view: {
                    ...allRecordsView(table.table),
                    query: request.query,
                  },
                }),
          }).andThen(({ catalog, outcome }) =>
            outcome.truncated
              ? err({
                  kind: 'fetch' as const,
                  message:
                    'This query exceeds the row limit. Narrow the filter.',
                })
              : ok({
                  rows: gridRows(outcome, catalog, table.columns),
                  tableVersion: table.table.version,
                })
          );
        }
      ),
    applyOps: ({ ops, baseVersions }) =>
      applyDatabaseOps(databaseId, ops, baseVersions).map((results) => ({
        results,
      })),
  };
}
