import { queryClient } from '@queries/client';
import {
  applyDatabaseOps,
  invalidateDatabase,
} from '@queries/storage/databases';
import { databasesKeys } from '@queries/storage/keys';
import type { DatabaseDetail } from '@service-storage/generated/schemas/databaseDetail';
import type { VersionedTable } from '@service-storage/generated/schemas/versionedTable';
import { ResultAsync } from 'neverthrow';
import type { DatabaseSchemaChange } from '../core/column-schema';
import { createKeyedSerializer } from '../core/keyed-serializer';

function withTableOrder(
  detail: DatabaseDetail,
  tableIds: string[]
): DatabaseDetail {
  const rank = new Map(tableIds.map((id, index) => [id, index]));
  return {
    ...detail,
    tables: detail.tables.toSorted(
      (a, b) =>
        (rank.get(a.table.id) ?? Number.MAX_SAFE_INTEGER) -
        (rank.get(b.table.id) ?? Number.MAX_SAFE_INTEGER)
    ),
  };
}

const writes = createKeyedSerializer();

function tableOrderOf(detail: DatabaseDetail | undefined) {
  return detail?.tables.map((entry) => entry.table.id);
}

function sameOrder(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined
) {
  return (
    left !== undefined &&
    right !== undefined &&
    left.length === right.length &&
    left.every((id, index) => id === right[index])
  );
}

/**
 * Show the new tab order at once and persist it. On failure only the tab
 * order goes back, and only when no newer move has replaced it; whatever
 * else changed in the cached detail meanwhile stays. The database is then
 * read again so a stale list of tables corrects itself.
 */
export function reorderDatabaseTables(params: {
  databaseId: string;
  tableIds: string[];
}): DatabaseSchemaChange {
  const key = databasesKeys.detail(params.databaseId).queryKey;
  const reorder = async () => {
    // An in-flight read must not paint the old order over the optimistic one.
    await queryClient.cancelQueries({ queryKey: key, exact: true });
    const previousOrder = tableOrderOf(
      queryClient.getQueryData<DatabaseDetail>(key)
    );
    queryClient.setQueryData(
      key,
      (current: DatabaseDetail | undefined) =>
        current && withTableOrder(current, params.tableIds)
    );
    // Requests go out in move order, so the last move is the one that sticks.
    const result = await writes.run(
      params.databaseId,
      async () =>
        await applyDatabaseOps(params.databaseId, [
          { kind: 'reorder_tables', order: params.tableIds },
        ])
    );
    if (result.isErr()) {
      queryClient.setQueryData(key, (current: DatabaseDetail | undefined) =>
        current &&
        previousOrder &&
        sameOrder(tableOrderOf(current), params.tableIds)
          ? withTableOrder(current, previousOrder)
          : current
      );
      void invalidateDatabase(params.databaseId);
      return result.map(() => undefined);
    }
    const [reordered] = result.value;
    if (reordered?.kind === 'reorder_tables') commit(key, reordered.tables);
    return result.map(() => undefined);
  };
  return new ResultAsync(reorder());
}

/** Each table's committed version; a cached table already past it keeps its own. */
function commit(key: readonly unknown[], tables: VersionedTable[]) {
  const committed = new Map(
    tables.map(({ table, version }) => [table, version])
  );
  queryClient.setQueryData(key, (current: DatabaseDetail | undefined) =>
    current
      ? {
          ...current,
          tables: current.tables.map((entry) => {
            const version = committed.get(entry.table.id);
            return version !== undefined && entry.table.version <= version
              ? { ...entry, table: { ...entry.table, version } }
              : entry;
          }),
        }
      : current
  );
}
