import type { ResultError } from '@core/util/result';
import { storageServiceClient } from '@service-storage/client';
import type { TableChanges } from '@service-storage/generated/schemas/tableChanges';
import { getGraphqlSoupCacheHost } from '@service-storage/graphql-soup';
import { errAsync, okAsync, ResultAsync } from 'neverthrow';
import { keyHintChunks, refreshPlan } from '../core/refresh-plan';

/** What an incremental refresh needs of the journal and the row cache. */
export type TableChangesCapabilities = {
  /** What changed in the table since a version. */
  since: (version: number) => ResultAsync<TableChanges, unknown>;
  /** Read these rows again from the network into the cache; the open reads rerun over it. */
  readRows: (rowIds: string[]) => ResultAsync<void, unknown>;
  /** Drop removed rows from the cache. */
  forget: (rowIds: string[]) => ResultAsync<void, unknown>;
};

/**
 * Catch a read held at `from` up to `version`: just the rows that changed, read by id in chunks
 * the engine narrows to `row_id IN (...)`, and removed rows dropped, then the open reads answered
 * again from the cache; anything else, or any failure, is a full read. Answers the version reached.
 */
export function refreshChangedRows<Failure>(params: {
  from: number;
  version: number;
  changes: TableChangesCapabilities;
  /** Answer the open reads from the cache the rows were read into, as at this version. */
  answerFromCache: (version: number) => ResultAsync<void, unknown>;
  fullRead: () => ResultAsync<void, Failure>;
}): ResultAsync<number, Failure> {
  const full = () => params.fullRead().map(() => params.version);
  return params.changes
    .since(params.from)
    .andThen((changes) => {
      const plan = refreshPlan(changes, params.version);
      if (plan.kind === 'full') return errAsync('full' as const);
      const reads = keyHintChunks(plan.written).map((chunk) =>
        params.changes.readRows(chunk)
      );
      return ResultAsync.combine(reads)
        .andThen(() =>
          plan.removed.length
            ? params.changes.forget(plan.removed)
            : okAsync(undefined)
        )
        .andThen(() => params.answerFromCache(plan.version))
        .map(() => plan.version);
    })
    .orElse(full);
}

/** The production journal reads, and the GraphQL cache's records, for one table. */
export function tableChangesOf(params: {
  databaseId: string;
  tableId: string;
  readRows: (rowIds: string[]) => ResultAsync<void, unknown>;
}): TableChangesCapabilities {
  return {
    since: (version) =>
      storageServiceClient.databases.tableChanges({
        id: params.databaseId,
        tableId: params.tableId,
        since: version,
      }),
    readRows: params.readRows,
    forget: (rowIds) => {
      const host = getGraphqlSoupCacheHost();
      if (!host) return okAsync(undefined);
      return ResultAsync.fromPromise(
        host.deleteRecords(rowIds.map((id) => `GraphqlSoupDatabaseRow:${id}`)),
        (thrown): ResultError[] => [
          { code: 'UNKNOWN', message: String(thrown) },
        ]
      ).map(() => undefined);
    },
  };
}
