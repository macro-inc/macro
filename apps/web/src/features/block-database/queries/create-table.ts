import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { databasesKeys } from '@queries/storage/keys';
import { storageServiceClient } from '@service-storage/client';
import type { TableCreationResult } from '../core/table-creation';

/** Resume setup by table ID so retrying a partial create never creates another table. */
export async function createTableWithName(params: {
  databaseId: string;
  name: string;
  existingTableId?: string;
}): Promise<TableCreationResult> {
  const queryKey = databasesKeys.detail(params.databaseId).queryKey;
  const refresh = async () => {
    await queryClient.cancelQueries({ queryKey });
    return queryClient.fetchQuery({
      queryKey,
      queryFn: () =>
        throwOnErr(() =>
          storageServiceClient.databases.get({ id: params.databaseId })
        ),
      staleTime: 0,
      retry: false,
    });
  };
  const tableId =
    params.existingTableId ??
    (
      await throwOnErr(() =>
        storageServiceClient.databases.createTable({
          id: params.databaseId,
          name: params.name,
        })
      )
    ).id;

  let hasName = false;
  try {
    if (params.existingTableId) {
      const detail = await refresh();
      hasName =
        detail.tables
          .find(({ table }) => table.id === tableId)
          ?.columns.some(
            ({ definition }) =>
              definition.definition.display_name.toLocaleLowerCase() === 'name'
          ) ?? false;
    }
    if (!hasName) {
      await throwOnErr(() =>
        storageServiceClient.databases.createColumn({
          id: params.databaseId,
          tableId,
          request: {
            binding: {
              kind: 'new',
              name: 'Name',
              data_type: 'STRING',
              is_multi_select: false,
            },
          },
        })
      );
      hasName = true;
      await refresh();
    }
    return { tableId, ready: true };
  } catch {
    void queryClient.invalidateQueries({ queryKey });
    return {
      tableId,
      ready: false,
      message: hasName
        ? 'Your table is ready, but could not be loaded. Try again to open it.'
        : 'Your table was created, but its Name column could not be added. Retry setup or open the table to continue.',
    };
  }
}
