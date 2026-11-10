/** Tables kept in sync with Granola or Notion. */

import { analytics } from '@app/lib/analytics';
import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { invalidateDatabase } from '@queries/storage/databases';
import { databasesKeys } from '@queries/storage/keys';
import { databaseSyncsClient } from '@service-cognition/database-syncs';
import type { DatabaseSync } from '@service-cognition/generated/schemas/databaseSync';
import type { DatabaseSyncSource } from '@service-cognition/generated/schemas/databaseSyncSource';
import { queryOptions, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { databaseSyncKeys } from './keys';

/** How often a list with a sync that has not run yet is read again. */
const PENDING_POLL_MS = 3000;
/** How long a list keeps reading after a run request without seeing it finish. */
const RUN_WAIT_MS = 60_000;

/** A run asked for: the sync as it read before, and when to stop waiting. */
export type AwaitedRun = { before: string; until: number };

const awaitedRuns = new Map<string, AwaitedRun>();

function runState(sync: DatabaseSync) {
  return JSON.stringify([sync.lastSyncedAt, sync.status]);
}

/**
 * How soon to read the list again: while a sync has not run yet, or a run was
 * asked for and the sync still reads as it did before (until `RUN_WAIT_MS`).
 * Runs that finished or timed out are dropped from `awaited`.
 */
export function syncListPollInterval(
  syncs: DatabaseSync[] | undefined,
  awaited: Map<string, AwaitedRun>,
  now: number
): number | false {
  let waiting = false;
  for (const sync of syncs ?? []) {
    if (sync.status.state === 'pending') waiting = true;
    const run = awaited.get(sync.id);
    if (!run) continue;
    if (runState(sync) !== run.before || now >= run.until) {
      awaited.delete(sync.id);
    } else {
      waiting = true;
    }
  }
  return waiting ? PENDING_POLL_MS : false;
}

function pollSyncList(query: { state: { data?: DatabaseSync[] } }) {
  return syncListPollInterval(query.state.data, awaitedRuns, Date.now());
}

function databaseSyncSourcesQueryOptions() {
  return queryOptions({
    queryKey: databaseSyncKeys.sources.queryKey,
    refetchOnMount: 'always',
    queryFn: () => throwOnErr(() => databaseSyncsClient.listSources()),
  });
}

function databaseSyncsQueryOptions(databaseId: string) {
  return queryOptions({
    queryKey: databaseSyncKeys.list(databaseId).queryKey,
    refetchOnMount: 'always',
    refetchInterval: pollSyncList,
    reconcile: 'id',
    queryFn: () => throwOnErr(() => databaseSyncsClient.list(databaseId)),
  });
}

/** Whether Granola is connected and which Notion data sources the viewer can read. */
export function useDatabaseSyncSources() {
  return useQuery(() => databaseSyncSourcesQueryOptions());
}

/** A database's syncs; polled while one has not run yet. */
export function useDatabaseSyncs(databaseId: Accessor<string>) {
  return useQuery(() => databaseSyncsQueryOptions(databaseId()));
}

function updateList(
  databaseId: string,
  update: (syncs: DatabaseSync[]) => DatabaseSync[]
) {
  queryClient.setQueryData<DatabaseSync[]>(
    databaseSyncKeys.list(databaseId).queryKey,
    (current) => current && update(current)
  );
}

/**
 * Add a synced table to the database. `id` is minted by the caller and reused
 * on a retry, so a retried request answers the sync the first one made.
 */
export function createTableSync(
  databaseId: string,
  id: string,
  source: DatabaseSyncSource
) {
  return databaseSyncsClient
    .create(databaseId, { id, source })
    .map(async (sync) => {
      updateList(databaseId, (syncs) => [
        ...syncs.filter((existing) => existing.id !== sync.id),
        sync,
      ]);
      await invalidateDatabase(databaseId);
      return sync;
    });
}

/** Create a database whose one table is synced with `source`. */
export function createSyncedDatabase(
  id: string,
  source: DatabaseSyncSource,
  createdFrom: string
) {
  return databaseSyncsClient.createDatabase({ id, source }).map((sync) => {
    analytics.track('create_entity', {
      entityType: 'database',
      entityId: sync.databaseId,
      source: createdFrom,
    });
    queryClient.invalidateQueries({ queryKey: databasesKeys.list.queryKey });
    return sync;
  });
}

/** Ask for a run now; the list reads again until it shows the run's outcome. */
export function runTableSync(databaseId: string, syncId: string) {
  const listKey = databaseSyncKeys.list(databaseId).queryKey;
  const before = queryClient
    .getQueryData<DatabaseSync[]>(listKey)
    ?.find((sync) => sync.id === syncId);
  return databaseSyncsClient.run(databaseId, syncId).map(() => {
    if (before) {
      awaitedRuns.set(syncId, {
        before: runState(before),
        until: Date.now() + RUN_WAIT_MS,
      });
    }
    queryClient.invalidateQueries({ queryKey: listKey });
  });
}

/** Stop syncing a table; the table and its rows stay. */
export function deleteTableSync(databaseId: string, syncId: string) {
  return databaseSyncsClient
    .delete(databaseId, syncId)
    .map(() =>
      updateList(databaseId, (syncs) =>
        syncs.filter((sync) => sync.id !== syncId)
      )
    );
}
