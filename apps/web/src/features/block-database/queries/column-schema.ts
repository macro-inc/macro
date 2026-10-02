import type {
  DatabaseOp,
  OpColumnKind,
} from '@core/database-sql/generated/types';
import { queryClient } from '@queries/client';
import { applyDatabaseOps } from '@queries/storage/databases';
import { databasesKeys } from '@queries/storage/keys';
import { ResultAsync } from 'neverthrow';
import { match } from 'ts-pattern';
import type {
  DatabaseColumnKind,
  DatabaseColumnTypeChange,
  DatabaseSchemaChange,
} from '../core/column-schema';

type ColumnMutation =
  | { kind: 'type'; columnId: string; change: DatabaseColumnTypeChange }
  | { kind: 'delete'; columnId: string }
  | { kind: 'order'; columnIds: string[] };

/** The op's spelling of a kind; a relation's rows live in this database. */
export function opColumnKind(
  databaseId: string,
  kind: DatabaseColumnKind
): OpColumnKind {
  return kind.type === 'relation'
    ? { type: 'relation', database: databaseId, table: kind.table }
    : kind;
}

/**
 * Refused if the table moved past `baseVersion`; schema and rows refresh
 * whatever the outcome, and a destructive change is never replayed.
 */
export function updateDatabaseColumns(params: {
  databaseId: string;
  tableId: string;
  baseVersion: number;
  mutation: ColumnMutation;
}): DatabaseSchemaChange {
  const table = params.tableId;
  const op = match(params.mutation)
    .returnType<DatabaseOp>()
    .with({ kind: 'type' }, ({ columnId, change }) => ({
      kind: 'column',
      table,
      column: columnId,
      change: {
        kind: 'change_type',
        to: opColumnKind(params.databaseId, change.to),
      },
    }))
    .with({ kind: 'delete' }, ({ columnId }) => ({
      kind: 'column',
      table,
      column: columnId,
      change: { kind: 'delete' },
    }))
    .with({ kind: 'order' }, ({ columnIds }) => ({
      kind: 'table',
      table,
      change: { kind: 'reorder_columns', order: columnIds },
    }))
    .exhaustive();
  const applied = applyDatabaseOps(params.databaseId, [op], {
    [table]: params.baseVersion,
  });
  // Open reads rerun against the refreshed schema, whatever the outcome.
  const refreshed = async () => {
    const result = await applied;
    await queryClient.invalidateQueries(
      { queryKey: databasesKeys.detail(params.databaseId).queryKey },
      { throwOnError: false }
    );
    return result.map(() => undefined);
  };
  return new ResultAsync(refreshed());
}
