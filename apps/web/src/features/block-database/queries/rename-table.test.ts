import { queryClient } from '@queries/client';
import { applyDatabaseOps } from '@queries/storage/databases';
import { databasesKeys } from '@queries/storage/keys';
import type { ApplyOpsResponse } from '@service-storage/generated/schemas/applyOpsResponse';
import type { DatabaseDetail } from '@service-storage/generated/schemas/databaseDetail';
import type { Table } from '@service-storage/generated/schemas/table';
import { QueryObserver } from '@tanstack/solid-query';
import { errAsync, ok, okAsync, type Result, ResultAsync } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tableRenameMessage } from '../core/column-schema';

function renameDatabaseTable(params: {
  databaseId: string;
  tableId: string;
  name: string;
  previousName: string;
}) {
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
  ]).map(() => undefined);
}

const transport = vi.hoisted(() => ({ applyOps: vi.fn() }));
vi.mock('@service-storage/client', () => ({
  storageServiceClient: { databases: transport },
}));
vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return {
    queryClient: new QueryClient({
      defaultOptions: { queries: { retry: false } },
    }),
  };
});

const original: Table = {
  id: 'guests',
  database_id: 'db',
  name: 'Guests',
  position: 'a',
  version: 5,
};
const renamed: Table = { ...original, name: 'Attendees', version: 6 };
const answer: ApplyOpsResponse = {
  results: [
    {
      kind: 'table',
      table: 'guests',
      tableVersion: 6,
      change: { kind: 'renamed' },
    },
  ],
  changes: [],
};
const detail: DatabaseDetail = {
  database: {
    id: 'db',
    name: 'Planning',
    owner_id: 'owner',
    created_at: '',
    trashed_at: null,
  },
  grant: 'owner',
  tables: [
    {
      views: [],
      table: original,
      sql_name: 'guests',
      columns: [],
    },
    {
      views: [],
      table: { ...original, id: 'other', name: 'Other' },
      sql_name: 'other',
      columns: [],
    },
  ],
};
const parameters = {
  databaseId: 'db',
  tableId: 'guests',
  name: 'Attendees',
  previousName: 'Guests',
};
const key = databasesKeys.detail('db').queryKey;

beforeEach(() => {
  vi.resetAllMocks();
  queryClient.setQueryData(key, detail);
  transport.applyOps.mockImplementation(() => okAsync(answer));
});
afterEach(() => queryClient.clear());

describe('table rename cache', () => {
  it('passes compare-and-swap identity, updates the named table, and invalidates other catalog schemas', async () => {
    const otherKey = databasesKeys.detail('other-db').queryKey;
    queryClient.setQueryData(otherKey, {
      ...detail,
      database: { ...detail.database, id: 'other-db' },
    });
    expect(await renameDatabaseTable(parameters)).toEqual(ok(undefined));
    expect(transport.applyOps).toHaveBeenCalledExactlyOnceWith({
      id: 'db',
      request: {
        ops: [
          {
            kind: 'table',
            table: 'guests',
            change: {
              kind: 'rename',
              name: 'Attendees',
              previousName: 'Guests',
            },
          },
        ],
      },
    });
    const updated = queryClient.getQueryData<DatabaseDetail>(key)!;
    expect(updated.tables[0]).toEqual({ ...detail.tables[0], table: renamed });
    expect(updated.tables[1]).toEqual(detail.tables[1]);
    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(otherKey)?.isInvalidated).toBe(true);
  });

  it('preserves the cache after a rejected rename and refreshes its database for recovery', async () => {
    const otherKey = databasesKeys.detail('other-db').queryKey;
    queryClient.setQueryData(otherKey, detail);
    transport.applyOps.mockImplementation(() =>
      errAsync([{ code: 'HTTP_ERROR', message: 'Name changed', refusal: null }])
    );
    const result = await renameDatabaseTable(parameters);
    expect(result.isErr() && tableRenameMessage(result.error)).toContain(
      'reopen Rename table'
    );
    expect(queryClient.getQueryData(key)).toEqual(detail);
    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(otherKey)?.isInvalidated).toBe(false);
  });

  it('keeps a committed rename successful when the follow-up schema refresh fails', async () => {
    const refresh = vi.fn(async (): Promise<DatabaseDetail> => {
      throw new Error('Connection lost');
    });
    const observer = new QueryObserver(queryClient, {
      queryKey: key,
      queryFn: refresh,
      staleTime: Infinity,
      retry: false,
    });
    const unsubscribe = observer.subscribe(() => {});
    try {
      expect(await renameDatabaseTable(parameters)).toEqual(ok(undefined));
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(
        queryClient.getQueryData<DatabaseDetail>(key)?.tables[0].table
      ).toEqual(renamed);
      expect(queryClient.getQueryState(key)?.status).toBe('error');
    } finally {
      unsubscribe();
    }
  });

  it('does not replace a newer cached table with a delayed rename acknowledgment', async () => {
    let complete!: (value: Result<ApplyOpsResponse, never>) => void;
    transport.applyOps.mockImplementation(
      () =>
        new ResultAsync(
          new Promise<Result<ApplyOpsResponse, never>>((resolve) => {
            complete = resolve;
          })
        )
    );
    const pending = renameDatabaseTable(parameters);
    const newer = { ...renamed, name: 'Team attendees', version: 7 };
    queryClient.setQueryData(key, {
      ...detail,
      tables: [{ ...detail.tables[0], table: newer }, detail.tables[1]],
    });
    complete(ok(answer));
    await pending;
    expect(
      queryClient.getQueryData<DatabaseDetail>(key)?.tables[0].table
    ).toEqual(newer);
  });

  it('does not let an older in-flight schema overwrite a successful rename after navigation', async () => {
    let complete!: (value: DatabaseDetail) => void;
    const previousFetch = queryClient
      .fetchQuery({
        queryKey: key,
        queryFn: () =>
          new Promise<DatabaseDetail>((resolve) => {
            complete = resolve;
          }),
        staleTime: 0,
      })
      .catch(() => undefined);
    await renameDatabaseTable(parameters);
    complete(detail);
    await previousFetch;
    expect(
      queryClient.getQueryData<DatabaseDetail>(key)?.tables[0].table
    ).toEqual(renamed);
  });
});
