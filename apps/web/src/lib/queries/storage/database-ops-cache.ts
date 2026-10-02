/** Cache effects shared by every caller of the database ops endpoint. */
import type { DatabaseOp } from '@core/database-sql/generated/types';
import type { DatabaseDetail } from '@service-storage/generated/schemas/databaseDetail';
import type { OpResult } from '@service-storage/generated/schemas/opResult';
import type { QueryClient } from '@tanstack/solid-query';
import { match } from 'ts-pattern';
import { databasesKeys } from './keys';

/** Schema operations need a fresh catalog; ordinary row writes only advance versions. */
export function changesDatabaseSchema(op: DatabaseOp): boolean {
  return op.kind === 'column' || op.kind === 'table';
}

function catalogKey(databaseId: string, ops: DatabaseOp[]) {
  // Table names and deleted relation targets affect other databases' catalogs.
  const global = ops.some(
    (op) => op.kind === 'table' && ['rename', 'delete'].includes(op.change.kind)
  );
  return global
    ? databasesKeys.detail._def
    : databasesKeys.detail(databaseId).queryKey;
}

/** Recover optimistic state after a refused or unreachable batch. */
export function refreshAfterDatabaseOps(
  client: QueryClient,
  databaseId: string,
  ops: DatabaseOp[]
) {
  return client.invalidateQueries(
    { queryKey: catalogKey(databaseId, ops) },
    { throwOnError: false }
  );
}

/**
 * Fold confirmed schema edits before notifying readers. A newer cached version wins
 * over a delayed answer. Process the batch in order, including repeated renames.
 */
export async function commitDatabaseOps(
  client: QueryClient,
  databaseId: string,
  ops: DatabaseOp[],
  results: OpResult[],
  versions: Record<string, number>
): Promise<void> {
  const schema = ops.some(changesDatabaseSchema);
  if (schema)
    await client.cancelQueries({ queryKey: catalogKey(databaseId, ops) });
  client.setQueryData<DatabaseDetail>(
    databasesKeys.detail(databaseId).queryKey,
    (previous) => {
      if (!previous) return previous;
      let detail = previous;
      for (const [index, result] of results.entries()) {
        const op = ops[index];
        if (!op || result.kind === 'reorder_tables') continue;
        const version = result.tableVersion ?? versions[result.table];
        if (version === undefined) continue;
        if (result.kind === 'table' && result.change.kind === 'deleted') {
          detail = {
            ...detail,
            tables: detail.tables.filter(
              (entry) =>
                entry.table.id !== result.table || entry.table.version > version
            ),
          };
          continue;
        }
        detail = {
          ...detail,
          tables: detail.tables.map((entry) => {
            if (
              entry.table.id !== result.table ||
              entry.table.version > version
            )
              return entry;
            return match(op)
              .with(
                { kind: 'table', change: { kind: 'rename' } },
                ({ change }) =>
                  result.kind === 'table' && result.change.kind === 'renamed'
                    ? { ...entry, table: { ...entry.table, name: change.name } }
                    : entry
              )
              .with(
                { kind: 'column', change: { kind: 'rename' } },
                ({ column: id, change }) =>
                  result.kind === 'column' && result.change.kind === 'renamed'
                    ? {
                        ...entry,
                        columns: entry.columns.map((column) =>
                          column.column.id === id
                            ? {
                                ...column,
                                column: {
                                  ...column.column,
                                  display_name: change.name,
                                },
                              }
                            : column
                        ),
                      }
                    : entry
              )
              .with(
                { kind: 'column', change: { kind: 'delete' } },
                ({ column: id }) =>
                  result.kind === 'column' && result.change.kind === 'deleted'
                    ? {
                        ...entry,
                        columns: entry.columns.filter(
                          (column) => column.column.id !== id
                        ),
                      }
                    : entry
              )
              .with(
                { kind: 'table', change: { kind: 'reorder_columns' } },
                ({ change }) => {
                  if (
                    result.kind !== 'table' ||
                    result.change.kind !== 'columns_reordered'
                  )
                    return entry;
                  const rank = new Map(change.order.map((id, i) => [id, i]));
                  return {
                    ...entry,
                    columns: entry.columns.toSorted(
                      (a, b) =>
                        (rank.get(a.column.id) ?? Infinity) -
                        (rank.get(b.column.id) ?? Infinity)
                    ),
                  };
                }
              )
              .otherwise(() => entry);
          }),
        };
      }
      return {
        ...detail,
        tables: detail.tables.map((entry) => {
          const version = versions[entry.table.id];
          return version !== undefined && version > entry.table.version
            ? { ...entry, table: { ...entry.table, version } }
            : entry;
        }),
      };
    }
  );
}
