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

function pollWhilePending(query: { state: { data?: DatabaseSync[] } }) {
  const pending = query.state.data?.some(
    (sync) => sync.status.state === 'pending'
  );
  return pending ? PENDING_POLL_MS : false;
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
    refetchInterval: pollWhilePending,
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

/** Ask for a run now; the list shows its outcome once it reads again. */
export function runTableSync(databaseId: string, syncId: string) {
  return databaseSyncsClient.run(databaseId, syncId).map(() => {
    queryClient.invalidateQueries({
      queryKey: databaseSyncKeys.list(databaseId).queryKey,
    });
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
