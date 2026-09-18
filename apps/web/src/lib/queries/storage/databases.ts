/**
 * Server state for Macro Databases.
 *
 * Schema reads go through `GET /databases/{id}`; every row read and write
 * goes through `POST /databases/exec`, which is the whole data surface.
 */
import { analytics } from '@app/lib/analytics';
import type { FetchWithTokenErrorCode } from '@core/util/fetchWithToken';
import { throwOnErr } from '@core/util/result';
import { storageServiceClient } from '@service-storage/client';
import type {
  CreateColumnRequest,
  DatabaseColumnDetail,
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

/** Run a read-only query as the viewer. Older servers fail closed with a 404. */
export async function querySql(sql: string): Promise<ExecOutcome> {
  const result = await storageServiceClient.databases.query({ sql });
  if (result.isErr()) {
    const failure = result.error[0];
    throw new ExecError(failure?.code ?? 'HTTP_ERROR', failure?.message ?? 'The database could not answer that question.');
  }
  return result.value;
}

/**
 * Re-read one database's schema.
 *
 * Deliberately narrow: rows live under their own key and are invalidated by
 * [`invalidateDatabaseRows`], so a schema change never re-runs every open
 * grid's `SELECT` — let alone another database's.
 */
export function invalidateDatabase(databaseId: string) {
  return queryClient.invalidateQueries({
    queryKey: databasesKeys.detail(databaseId).queryKey,
  });
}

export function invalidateDatabaseRows(databaseId: string, tableId: string) {
  return Promise.all([queryClient.invalidateQueries({
    queryKey: databasesKeys.rows(databaseId, tableId).queryKey,
  }), queryClient.invalidateQueries({
    predicate: (query) => {
      if (query.queryKey[0] !== 'database-query') return false;
      const data = query.state.data as { read_versions?: Record<string, number> } | undefined;
      return !!data?.read_versions && tableId in data.read_versions;
    },
  })]);
}

/**
 * Fold the versions a write reported straight into the cached schema.
 *
 * The version is the only part of the detail response a write moves, so
 * patching it in place spares the grid a schema refetch it would otherwise
 * make on every cell edit.
 */
export function applyDatabaseTableVersions(
  databaseId: string,
  newVersions: Record<string, number>
) {
  if (Object.keys(newVersions).length === 0) return;

  queryClient.setQueryData(
    databasesKeys.detail(databaseId).queryKey,
    (previous: DatabaseDetail | undefined): DatabaseDetail | undefined => {
      if (!previous) return previous;
      return {
        ...previous,
        tables: previous.tables.map((table) => {
          const version = newVersions[table.table.id];
          if (version === undefined || version === table.table.version) {
            return table;
          }
          return { ...table, table: { ...table.table, version } };
        }),
      };
    }
  );
}

/** Add a table (tab) to a database and return its id. */
export async function createDatabaseTable(params: {
  databaseId: string;
  name: string;
}): Promise<string | undefined> {
  const result = await storageServiceClient.databases.createTable({
    id: params.databaseId,
    name: params.name,
  });
  if (result.isErr()) return undefined;

  await invalidateDatabase(params.databaseId);
  return result.value.id;
}

/** Add a column to a table and return its id. */
export async function createDatabaseColumn(params: {
  databaseId: string;
  tableId: string;
  request: CreateColumnRequest;
}): Promise<string | undefined> {
  const result = await storageServiceClient.databases.createColumn({
    id: params.databaseId,
    tableId: params.tableId,
    request: params.request,
  });
  if (result.isErr()) return undefined;

  await invalidateDatabase(params.databaseId);
  return result.value.columnId;
}

/**
 * Add select option labels to a column and return the column as it now stands.
 *
 * Returns `undefined` if the service refused. The updated column is folded
 * into the cached schema rather than refetched, so the dropdown that asked for
 * the option can offer it on the very next open; the table's rows are
 * invalidated because the option list is a CHECK on what they may hold.
 */
export async function addDatabaseColumnOptions(params: {
  databaseId: string;
  tableId: string;
  columnId: string;
  labels: string[];
}): Promise<DatabaseColumnDetail | undefined> {
  const result = await storageServiceClient.databases.addColumnOptions({
    id: params.databaseId,
    tableId: params.tableId,
    columnId: params.columnId,
    request: { labels: params.labels },
  });
  if (result.isErr()) return undefined;

  const updated = result.value;
  queryClient.setQueryData(
    databasesKeys.detail(params.databaseId).queryKey,
    (previous: DatabaseDetail | undefined): DatabaseDetail | undefined => {
      if (!previous) return previous;
      return {
        ...previous,
        tables: previous.tables.map((table) =>
          table.table.id === params.tableId
            ? {
                ...table,
                columns: table.columns.map((column) =>
                  column.column.id === params.columnId ? updated : column
                ),
              }
            : table
        ),
      };
    }
  );
  await invalidateDatabaseRows(params.databaseId, params.tableId);

  return updated;
}

/** Fetch a database's SQLite snapshot as a blob. */
export function downloadDatabaseSnapshot(databaseId: string): Promise<Blob> {
  return storageServiceClient.databases.downloadSqlite({ id: databaseId });
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
