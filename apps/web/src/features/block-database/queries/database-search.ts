/** Searching every table of a database: one engine read per table, over the GraphQL row source. */
import { databaseSqlSchema } from '@core/database-sql/catalog';
import type { DatabaseSqlFailure } from '@core/database-sql/driver';
import {
  type DatabaseSqlQueryCapabilities,
  type DatabaseSqlStatement,
  readDatabaseSql,
} from '@queries/database-sql/create-database-sql-query';
import type { DatabaseDetail } from '@service-storage/generated/schemas/databaseDetail';
import type { TableDetail } from '@service-storage/generated/schemas/tableDetail';
import { ResultAsync } from 'neverthrow';
import { match } from 'ts-pattern';
import {
  type DatabaseSearchGroup,
  databaseSearchGroups,
} from '../core/database-search';
import { gridRows } from '../core/grid-cells';
import { searchFilter } from '../core/view-query';
import { allRecordsView } from '../core/views';
import { toViewColumn } from './table-rows';

/**
 * The read of each table that can hold `term`: its All records narrowed to
 * rows with the term in a text cell or an option's label. A table with no
 * such column, or a blank term, reads nothing.
 */
export function databaseSearchStatements(
  detail: DatabaseDetail,
  term: string
): { table: TableDetail; statement: DatabaseSqlStatement }[] {
  return detail.tables.flatMap((table) =>
    match(searchFilter(term, table.columns.map(toViewColumn)))
      .with({ kind: 'matching', filter: { kind: 'group' } }, ({ filter }) => {
        const view = allRecordsView(table.table);
        return [
          {
            table,
            statement: {
              schema: databaseSqlSchema([{ ...detail, tables: [table] }]),
              scope: detail.database.id,
              view: {
                ...view,
                query: {
                  filter: {
                    conjunction: filter.conjunction,
                    conditions: filter.conditions,
                  },
                  sort: [],
                },
              },
            },
          },
        ];
      })
      .otherwise(() => [])
  );
}

/** Every table's matches for `term`, grouped by table. */
export function searchDatabase(
  detail: DatabaseDetail,
  term: string,
  read?: DatabaseSqlQueryCapabilities
): ResultAsync<DatabaseSearchGroup[], DatabaseSqlFailure> {
  return ResultAsync.combine(
    databaseSearchStatements(detail, term).map(({ table, statement }) =>
      readDatabaseSql(statement, read).map(({ catalog, outcome }) => ({
        tableId: table.table.id,
        tableName: table.table.name,
        columns: table.columns.map(toViewColumn),
        rows: gridRows(outcome, catalog, table.columns),
      }))
    )
  ).map((answers) => databaseSearchGroups(term, answers));
}
