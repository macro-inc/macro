import { queryReadyGate } from '@queries/gate';
import {
  type QueryClient,
  type QueryKey,
  queryOptions,
  useQuery,
} from '@tanstack/solid-query';
import { err, ok, ResultAsync } from 'neverthrow';
import { type Accessor, createSignal } from 'solid-js';
import { v7 as uuidv7 } from 'uuid';
import type { DatabaseRowsSource } from '../context/table-source';
import type {
  DatabaseApi,
  DatabaseRowRequest,
  DatabaseTableSchema,
} from '../core/api';
import { boardInput } from '../core/board-input';
import { writeDatabaseRow } from '../core/row-write';
import type { DatabaseRow } from '../core/table';
import type { DatabaseViewState } from '../core/view-state';
import type { DatabaseReadFailure } from '../core/write-failure';

export type DatabaseDataSource = {
  table: Accessor<DatabaseTableSchema | undefined>;
  rows: DatabaseRowsSource;
};

/** Pages must belong to one version; never show a mixture from concurrent edits. */
export async function readDatabasePages(
  api: DatabaseApi,
  request: DatabaseRowRequest
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const rows: DatabaseRow[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    let version: number | undefined;
    do {
      const page = await api.readRows({ ...request, cursor });
      if (page.isErr()) return page;
      if (version !== undefined && page.value.tableVersion !== version) break;
      version = page.value.tableVersion;
      rows.push(...page.value.rows);
      cursor = page.value.nextCursor;
      if (!cursor) return ok({ rows, version });
      if (seen.has(cursor))
        return err<never, DatabaseReadFailure>({
          kind: 'fetch',
          message: 'The API returned a repeated cursor.',
        });
      seen.add(cursor);
    } while (cursor);
  }
  return err<never, DatabaseReadFailure>({
    kind: 'fetch',
    message: 'The table changed while loading. Refresh and try again.',
  });
}

function tableSchemaQueryOptions(
  api: DatabaseApi,
  key: QueryKey,
  tableId: string
) {
  return queryOptions({
    queryKey: [...key, 'schema'],
    // Polls refetch the schema; stable columns keep cells from remounting previews.
    reconcile: 'id',
    queryFn: async () => {
      const result = await api.readTable(tableId);
      if (result.isErr()) throw result.error;
      return result.value;
    },
  });
}

function tableRowsQueryOptions(
  api: DatabaseApi,
  key: QueryKey,
  request: DatabaseRowRequest
) {
  return queryOptions({
    queryKey: [...key, 'rows', request.query],
    queryFn: async () => {
      const result = await readDatabasePages(api, request);
      if (result.isErr()) throw result.error;
      return result.value;
    },
  });
}

function retainedRowsQueryOptions(
  api: DatabaseApi,
  key: QueryKey,
  tableId: string,
  rowIds: string[]
) {
  return queryOptions({
    queryKey: [...key, 'retained', [...rowIds].sort()],
    enabled: rowIds.length > 0,
    queryFn: async () => {
      const result = await readDatabasePages(api, {
        tableId,
        query: { filter: null },
        rowIds,
      });
      if (result.isErr()) throw result.error;
      return result.value;
    },
  });
}

/** Default data adapter for a paginated, database-shaped API. */
export function createDatabaseApiSource(args: {
  api: DatabaseApi;
  tableId: string;
  view: Accessor<DatabaseViewState>;
  client: QueryClient;
}): DatabaseDataSource {
  const { api, tableId, client } = args;
  const key = [...api.key, 'database-editor', tableId];
  const [retained, setRetained] = createSignal<Accessor<readonly string[]>>(
    () => []
  );
  const table = useQuery(
    () => tableSchemaQueryOptions(api, key, tableId),
    () => client
  );
  const rows = useQuery(
    () =>
      tableRowsQueryOptions(api, key, { tableId, query: args.view().query }),
    () => client
  );
  const held = useQuery(
    () => retainedRowsQueryOptions(api, key, tableId, [...retained()()]),
    () => client
  );
  const schema = () => (queryReadyGate(table) ? table.data : undefined);
  const refresh = () =>
    ResultAsync.fromPromise(
      client.invalidateQueries({ queryKey: key }, { throwOnError: true }),
      (): DatabaseReadFailure => ({
        kind: 'fetch',
        message: 'Could not refresh this table.',
      })
    );
  return {
    table: schema,
    rows: {
      columns: () => schema()?.columns ?? [],
      read: () => {
        const table = schema();
        return table && queryReadyGate(rows)
          ? boardInput(table, rows.data.rows, args.view())
          : undefined;
      },
      snapshot: () =>
        queryReadyGate(rows)
          ? {
              rows: rows.data.rows,
              version: rows.data.version,
              retained: queryReadyGate(held) ? held.data.rows : [],
            }
          : undefined,
      loading: () => table.isPending || rows.isPending,
      refreshing: () => table.isRefetching || rows.isRefetching,
      error: () =>
        table.isError ||
        rows.isError ||
        (retained()().length > 0 && held.isError)
          ? { kind: 'fetch', message: 'Could not read this table.' }
          : undefined,
      refresh,
      retain: (ids) => setRetained(() => ids),
      write: (mutation, _base, createOptions) =>
        writeDatabaseRow(
          {
            tableId,
            columns: schema()?.columns ?? [],
            applyOps: (batch) => api.applyOps(batch),
          },
          mutation,
          createOptions
        ),
      addOption: (column, label) =>
        api
          .applyOps({
            ops: [
              {
                kind: 'column',
                table: tableId,
                column,
                change: {
                  kind: 'add_options',
                  options: [{ id: uuidv7(), label }],
                },
              },
            ],
          })
          .andThen(() => refresh().orElse(() => ok(undefined))),
    },
  };
}
