/**
 * Server state for Macro Databases.
 *
 * Schema reads go through `GET /databases/{id}`; every row read and write
 * goes through `POST /databases/exec`, which is the whole data surface.
 */
import { analytics } from '@app/lib/analytics';
import type { FetchWithTokenErrorCode } from '@core/util/fetchWithToken';
import { throwOnErr } from '@core/util/result';
import { createConnectionWebsocketEffect } from '@service-connection/websocket';
import { storageServiceClient } from '@service-storage/client';
import type {
  DatabaseDetail,
  ExecErrorCode,
  ExecOutcome,
  ExecRequest,
  ListedDatabase,
} from '@service-storage/databases';
import { useQuery } from '@tanstack/solid-query';
import { queryClient } from '../client';
import { databasesKeys } from './keys';

const DATABASE_STALE_TIME = 30 * 1000;

/** Gateway message type published by `crates/databases` on every write. */
const TABLE_CHANGED_MESSAGE_TYPE = 'database_table_changed';

type TableChangedMessage = {
  databaseId: string;
  tableId: string;
  version: number;
};

export function useDatabasesQuery() {
  return useQuery(() => ({
    queryKey: databasesKeys.list.queryKey,
    queryFn: async (): Promise<ListedDatabase[]> =>
      throwOnErr(async () => await storageServiceClient.databases.list()),
    staleTime: DATABASE_STALE_TIME,
  }));
}

export function useDatabaseDetailQuery(databaseId: () => string | undefined) {
  return useQuery(() => {
    const id = databaseId();
    return {
      queryKey: databasesKeys.detail(id ?? '').queryKey,
      queryFn: async (): Promise<DatabaseDetail> =>
        throwOnErr(
          async () => await storageServiceClient.databases.get({ id: id! })
        ),
      staleTime: DATABASE_STALE_TIME,
      enabled: !!id,
    };
  });
}

/** A refused `exec`: the service's message plus why it refused. */
export class ExecError extends Error {
  constructor(
    readonly code: FetchWithTokenErrorCode | ExecErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'ExecError';
  }
}

/** Run SQL as the current viewer. Throws an [`ExecError`] on failure. */
export async function execSql(request: ExecRequest): Promise<ExecOutcome> {
  const result = await storageServiceClient.databases.exec(request);
  if (result.isErr()) {
    const failure = result.error[0];
    throw new ExecError(
      failure?.code ?? 'HTTP_ERROR',
      failure?.message ?? 'The database could not run that statement.'
    );
  }
  return result.value;
}

export function invalidateDatabase(databaseId: string) {
  return Promise.all([
    queryClient.invalidateQueries({
      queryKey: databasesKeys.detail(databaseId).queryKey,
    }),
    queryClient.invalidateQueries({
      queryKey: databasesKeys._def,
    }),
  ]);
}

export function invalidateDatabaseRows(databaseId: string, tableId: string) {
  return queryClient.invalidateQueries({
    queryKey: databasesKeys.rows(databaseId, tableId).queryKey,
  });
}

/**
 * Create a database and return its id.
 *
 * The service seeds it with one starter table, so the block has something to
 * render the moment it opens.
 */
export async function createDatabase(params: {
  name: string;
  /** UI surface the creation originated from, for analytics. */
  source?: string;
}): Promise<string | undefined> {
  const result = await storageServiceClient.databases.create({
    name: params.name,
  });
  if (result.isErr()) return undefined;

  const databaseId = result.value.id;
  analytics.track('create_entity', {
    entityType: 'database',
    entityId: databaseId,
    source: params.source,
  });
  await queryClient.invalidateQueries({
    queryKey: databasesKeys.list.queryKey,
  });
  return databaseId;
}

/**
 * Re-read a database whenever the gateway reports one of its tables changed.
 *
 * Results are never pushed — the message carries only the table's new version,
 * and every viewer re-executes its own queries as itself.
 */
export function useDatabaseTableChangedSync(
  databaseId: () => string | undefined
) {
  createConnectionWebsocketEffect((message) => {
    if (message.type !== TABLE_CHANGED_MESSAGE_TYPE) return;

    let data: TableChangedMessage;
    try {
      data =
        typeof message.data === 'string'
          ? JSON.parse(message.data)
          : message.data;
    } catch {
      console.error('unparsable database_table_changed payload', message);
      return;
    }

    if (!data?.databaseId || data.databaseId !== databaseId()) return;

    invalidateDatabase(data.databaseId);
    if (data.tableId) invalidateDatabaseRows(data.databaseId, data.tableId);
  });
}
