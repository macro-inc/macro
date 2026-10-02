import { queryClient } from '@queries/client';
import { applyDatabaseOps } from '@queries/storage/databases';
import { databasesKeys } from '@queries/storage/keys';
import type { DatabaseSchemaChange } from '../core/column-schema';
import { isResult, patchTableColumn } from './detail-cache';

/** Change the placement label while preserving column IDs and stored SQL. */
export function renameDatabaseColumn(params: {
  databaseId: string;
  tableId: string;
  columnId: string;
  name: string;
  previousName: string;
}): DatabaseSchemaChange {
  const queryKey = databasesKeys.detail(params.databaseId).queryKey;
  return applyDatabaseOps(params.databaseId, [
    {
      kind: 'column',
      table: params.tableId,
      column: params.columnId,
      change: {
        kind: 'rename',
        name: params.name,
        previousName: params.previousName,
      },
    },
  ])
    .mapErr((error) => {
      void queryClient.invalidateQueries({ queryKey });
      return error;
    })
    .map(async ([result]) => {
      // A newer version may contain another rename, so a delayed response
      // must not replace it.
      if (isResult(result, 'column', 'renamed'))
        await patchTableColumn(queryClient, {
          databaseId: params.databaseId,
          tableId: params.tableId,
          columnId: params.columnId,
          tableVersion: result.tableVersion,
          change: (column) => ({
            ...column,
            column: { ...column.column, display_name: params.name },
          }),
        });
      // Open reads rerun against the refreshed schema. The refresh may not report
      // an already-committed rename as a failed write.
      await queryClient.invalidateQueries(
        { queryKey },
        { throwOnError: false }
      );
    });
}
