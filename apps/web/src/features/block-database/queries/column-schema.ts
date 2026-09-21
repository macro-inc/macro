import { queryClient } from '@queries/client';
import { invalidateDatabaseRows } from '@queries/storage/databases';
import { databasesKeys } from '@queries/storage/keys';
import { storageServiceClient } from '@service-storage/client';
import type { DatabaseColumnTypeChange } from '../core/column-schema';

type ColumnMutation =
  | { kind: 'type'; columnId: string; change: DatabaseColumnTypeChange }
  | { kind: 'delete'; columnId: string }
  | { kind: 'order'; columnIds: string[] };

/** Refresh schema and rows even on a conflict; never replay a destructive mutation. */
export async function updateDatabaseColumns(params: {
  databaseId: string;
  tableId: string;
  baseVersion: number;
  mutation: ColumnMutation;
}): Promise<void> {
  const common = {
    id: params.databaseId,
    tableId: params.tableId,
    baseVersion: params.baseVersion,
  };
  const mutation = params.mutation;
  const result =
    mutation.kind === 'type'
      ? await storageServiceClient.databases.changeColumnType({
          ...common,
          columnId: mutation.columnId,
          request: { ...mutation.change, baseVersion: params.baseVersion },
        })
      : mutation.kind === 'delete'
        ? await storageServiceClient.databases.deleteColumn({
            ...common,
            columnId: mutation.columnId,
          })
        : await storageServiceClient.databases.reorderColumns({
            ...common,
            columnIds: mutation.columnIds,
          });
  await Promise.all([
    queryClient.invalidateQueries(
      { queryKey: databasesKeys.detail(params.databaseId).queryKey },
      { throwOnError: false }
    ),
    invalidateDatabaseRows(params.databaseId, params.tableId),
  ]);
  if (result.isErr())
    throw new Error(
      result.error
        .map((error) =>
          error.message?.replace(/^invalid schema operation: /, '')
        )
        .filter(Boolean)
        .join('\n') ||
        'This column could not be updated. Refresh and try again.'
    );
}
