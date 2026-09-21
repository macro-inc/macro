import { queryClient } from '@queries/client';
import {
  invalidateDatabase,
  invalidateDatabaseRows,
} from '@queries/storage/databases';
import { databasesKeys } from '@queries/storage/keys';
import { storageServiceClient } from '@service-storage/client';
import type { DatabaseDetail } from '@service-storage/databases';

export async function renameDatabaseTable(params: {
  databaseId: string;
  tableId: string;
  name: string;
  previousName: string;
}): Promise<void> {
  const result = await storageServiceClient.databases.renameTable({
    id: params.databaseId,
    tableId: params.tableId,
    name: params.name,
    previousName: params.previousName,
  });
  if (result.isErr()) {
    void invalidateDatabase(params.databaseId);
    throw new Error(
      'Could not rename this table. Its name may have changed. Check your connection, or reopen Rename table and try again.'
    );
  }
  // An older request must not overwrite the committed name after navigation.
  await queryClient.cancelQueries({ queryKey: databasesKeys.detail._def });
  queryClient.setQueryData(
    databasesKeys.detail(params.databaseId).queryKey,
    (previous: DatabaseDetail | undefined) =>
      previous && {
        ...previous,
        tables: previous.tables.map((entry) =>
          entry.table.id === params.tableId &&
          entry.table.version <= result.value.version
            ? { ...entry, table: result.value }
            : entry
        ),
      }
  );
  // Physical SQL names can change throughout the catalog. Read aliases stay stable.
  // Cell writes use the rows snapshot's version, which also advances on rename.
  // A refresh failure does not turn the committed rename into a failed write.
  await Promise.all([
    queryClient.invalidateQueries(
      { queryKey: databasesKeys.detail._def },
      { throwOnError: false }
    ),
    invalidateDatabaseRows(params.databaseId, params.tableId),
  ]);
}
