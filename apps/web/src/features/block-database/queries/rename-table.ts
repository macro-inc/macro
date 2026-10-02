import { queryClient } from '@queries/client';
import {
  applyDatabaseOps,
  invalidateDatabase,
} from '@queries/storage/databases';
import { databasesKeys } from '@queries/storage/keys';
import type { DatabaseDetail } from '@service-storage/generated/schemas/databaseDetail';
import type { DatabaseSchemaChange } from '../core/column-schema';
import { isResult } from './detail-cache';

export function renameDatabaseTable(params: {
  databaseId: string;
  tableId: string;
  name: string;
  previousName: string;
}): DatabaseSchemaChange {
  return applyDatabaseOps(params.databaseId, [
    {
      kind: 'table',
      table: params.tableId,
      change: {
        kind: 'rename',
        name: params.name,
        previousName: params.previousName,
      },
    },
  ])
    .mapErr((error) => {
      void invalidateDatabase(params.databaseId);
      return error;
    })
    .map(async ([result]) => {
      // An older request must not overwrite the committed name after navigation.
      await queryClient.cancelQueries({ queryKey: databasesKeys.detail._def });
      const version = isResult(result, 'table', 'renamed')
        ? result.tableVersion
        : undefined;
      if (version !== undefined) {
        queryClient.setQueryData(
          databasesKeys.detail(params.databaseId).queryKey,
          (previous: DatabaseDetail | undefined) =>
            previous && {
              ...previous,
              tables: previous.tables.map((entry) =>
                entry.table.id === params.tableId &&
                entry.table.version <= version
                  ? {
                      ...entry,
                      table: { ...entry.table, name: params.name, version },
                    }
                  : entry
              ),
            }
        );
      }
      // SQL names can change throughout the catalog; open reads rerun against it.
      // A refresh failure does not turn the committed rename into a failed write.
      await queryClient.invalidateQueries(
        { queryKey: databasesKeys.detail._def },
        { throwOnError: false }
      );
    });
}
