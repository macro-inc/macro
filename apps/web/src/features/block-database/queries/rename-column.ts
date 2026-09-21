import { queryClient } from '@queries/client';
import { invalidateDatabaseRows } from '@queries/storage/databases';
import { databasesKeys } from '@queries/storage/keys';
import { storageServiceClient } from '@service-storage/client';
import type { DatabaseDetail } from '@service-storage/databases';

/** Change the placement label while preserving column IDs and stored SQL. */
export async function renameDatabaseColumn(params: {
  databaseId: string;
  tableId: string;
  columnId: string;
  name: string;
  previousName: string;
}): Promise<void> {
  const queryKey = databasesKeys.detail(params.databaseId).queryKey;
  const result = await storageServiceClient.databases.renameColumn({
    id: params.databaseId,
    tableId: params.tableId,
    columnId: params.columnId,
    name: params.name,
    previousName: params.previousName,
  });
  if (result.isErr()) {
    void queryClient.invalidateQueries({ queryKey });
    const validation = result.error.find(
      (error) => error.code === 'INVALID_SCHEMA'
    );
    throw new Error(
      validation?.message ??
        'Could not rename this column. Check your connection and try again.'
    );
  }

  // Cancel an older schema read before seeding the committed label. A newer
  // version may contain another rename, so a delayed response must not replace it.
  await queryClient.cancelQueries({ queryKey });
  queryClient.setQueryData(
    queryKey,
    (previous: DatabaseDetail | undefined) =>
      previous && {
        ...previous,
        tables: previous.tables.map((entry) =>
          entry.table.id === params.tableId &&
          entry.table.version <= result.value.table_version
            ? {
                ...entry,
                table: { ...entry.table, version: result.value.table_version },
                columns: entry.columns.map((column) =>
                  column.column.id === params.columnId
                    ? { ...column, column: result.value.column }
                    : column
                ),
              }
            : entry
        ),
      }
  );
  // The next cell edit uses the rows snapshot's version, not the schema's.
  // Re-read rows rather than assigning a new version to potentially older data.
  // Neither refresh may report an already-committed rename as a failed write.
  await Promise.all([
    queryClient.invalidateQueries({ queryKey }, { throwOnError: false }),
    invalidateDatabaseRows(params.databaseId, params.tableId),
  ]);
}
