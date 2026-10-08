import { queryClient } from '@queries/client';
import {
  applyDatabaseOps,
  databaseDetailQueryOptions,
} from '@queries/storage/databases';
import { databasesKeys } from '@queries/storage/keys';
import { okAsync, ResultAsync } from 'neverthrow';
import { v7 as uuidv7 } from 'uuid';
import type { DatabaseSchemaChange } from '../../database/core/column-schema';
import type { TableCreationResult } from '../../database/core/table-creation';

/**
 * Create a table with its Name column, which infers its type like any new
 * text column, in one batch, then load it. Retrying with `existingTableId`
 * only loads the table a committed create left.
 */
export function createTableWithName(params: {
  databaseId: string;
  name: string;
  existingTableId?: string;
}): DatabaseSchemaChange<TableCreationResult> {
  const queryKey = databasesKeys.detail(params.databaseId).queryKey;
  const created = params.existingTableId
    ? okAsync(params.existingTableId)
    : createWithName(params.databaseId, params.name);
  return created.andThen((tableId) =>
    ResultAsync.fromSafePromise(load(tableId))
  );

  async function load(tableId: string): Promise<TableCreationResult> {
    try {
      await queryClient.cancelQueries({ queryKey, exact: true });
      await queryClient.fetchQuery({
        ...databaseDetailQueryOptions(params.databaseId),
        staleTime: 0,
      });
      return { tableId, ready: true };
    } catch {
      void queryClient.invalidateQueries({ queryKey });
      return {
        tableId,
        ready: false,
        message:
          'Your table is ready, but could not be loaded. Try again to open it.',
      };
    }
  }
}

function createWithName(
  databaseId: string,
  name: string
): DatabaseSchemaChange<string> {
  const tableId = uuidv7();
  return applyDatabaseOps(databaseId, [
    { kind: 'table', table: tableId, change: { kind: 'create', name } },
    {
      kind: 'column',
      table: tableId,
      column: uuidv7(),
      change: {
        kind: 'create',
        definition: {
          source: 'new',
          name: 'Name',
          type: { type: 'text' },
          inferType: true,
        },
      },
    },
  ]).map(() => tableId);
}
