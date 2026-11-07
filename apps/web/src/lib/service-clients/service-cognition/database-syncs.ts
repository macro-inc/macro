/** Synced tables: database tables the cognition service keeps in sync with Granola or Notion. */

import { SERVER_HOSTS } from '@core/constant/servers';
import {
  type FetchWithTokenErrorCode,
  fetchWithToken,
} from '@core/util/fetchWithToken';
import type { ResultError } from '@core/util/result';
import { ResultAsync } from 'neverthrow';
import {
  getCreateDatabaseSyncUrl,
  getCreateSyncedDatabaseUrl,
  getDeleteDatabaseSyncUrl,
  getListDatabaseSyncSourcesUrl,
  getListDatabaseSyncsUrl,
  getRunDatabaseSyncUrl,
} from './generated/client';
import type { CreateDatabaseSyncRequest } from './generated/schemas/createDatabaseSyncRequest';
import type { DatabaseSync } from './generated/schemas/databaseSync';
import type { DatabaseSyncSources } from './generated/schemas/databaseSyncSources';
import type { ListDatabaseSyncsResponse } from './generated/schemas/listDatabaseSyncsResponse';

type DatabaseSyncErrors = ResultError<FetchWithTokenErrorCode>[];

const cognitionHost: string = SERVER_HOSTS['cognition-service'];

function syncFetch<Response extends object>(
  path: string,
  init: RequestInit
): ResultAsync<Response, DatabaseSyncErrors> {
  return new ResultAsync(
    fetchWithToken<Response>(`${cognitionHost}${path}`, init)
  );
}

export const databaseSyncsClient = {
  /** Whether Granola is connected, and the Notion data sources the caller can read. */
  listSources() {
    return syncFetch<DatabaseSyncSources>(getListDatabaseSyncSourcesUrl(), {
      method: 'GET',
    });
  },

  /** A database's syncs, oldest first. */
  list(databaseId: string) {
    return syncFetch<ListDatabaseSyncsResponse>(
      getListDatabaseSyncsUrl(databaseId),
      { method: 'GET' }
    ).map(({ syncs }) => syncs);
  },

  /** Add a synced table to a database; retrying with the same `id` answers the same sync. */
  create(databaseId: string, request: CreateDatabaseSyncRequest) {
    return syncFetch<DatabaseSync>(getCreateDatabaseSyncUrl(databaseId), {
      method: 'POST',
      body: JSON.stringify(request),
    });
  },

  /** Create a database named after the source, whose one table is synced. */
  createDatabase(request: CreateDatabaseSyncRequest) {
    return syncFetch<DatabaseSync>(getCreateSyncedDatabaseUrl(), {
      method: 'POST',
      body: JSON.stringify(request),
    });
  },

  /** Ask for a run now. */
  run(databaseId: string, syncId: string) {
    return syncFetch<object>(getRunDatabaseSyncUrl(databaseId, syncId), {
      method: 'POST',
    }).map(() => undefined);
  },

  /** Stop syncing; the table and its rows stay. */
  delete(databaseId: string, syncId: string) {
    return syncFetch<object>(getDeleteDatabaseSyncUrl(databaseId, syncId), {
      method: 'DELETE',
    }).map(() => undefined);
  },
};
