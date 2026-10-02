import { queryClient } from '@queries/client';
import { applyDatabaseOps } from '@queries/storage/databases';
import { databasesKeys } from '@queries/storage/keys';
import type { DatabaseDetail } from '@service-storage/generated/schemas/databaseDetail';
import type { DatabaseSchemaChange } from '../core/column-schema';

/** Delete a table with its columns, rows and views; the service keeps a database's last table. */
export function deleteDatabaseTable(params: {
  databaseId: string;
  tableId: string;
}): DatabaseSchemaChange {
  return applyDatabaseOps(params.databaseId, [
    { kind: 'table', table: params.tableId, change: { kind: 'delete' } },
  ]).map(async () => {
    const key = databasesKeys.detail(params.databaseId).queryKey;
    // An older read must not bring the deleted tab back.
    await queryClient.cancelQueries({ queryKey: key });
    queryClient.setQueryData(
      key,
      (previous: DatabaseDetail | undefined) =>
        previous && {
          ...previous,
          tables: previous.tables.filter(
            (entry) => entry.table.id !== params.tableId
          ),
        }
    );
    // Relations to the table went with it, so every catalog reads again.
    await queryClient.invalidateQueries(
      { queryKey: databasesKeys.detail._def },
      { throwOnError: false }
    );
  });
}
