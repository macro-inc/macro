import { queryClient } from '@queries/client';
import { databaseQueryKeys, databasesKeys } from '@queries/storage/keys';
import type {
  DatabaseDetail,
  DatabaseTable,
  ExecOutcome,
} from '@service-storage/databases';
import { QueryObserver } from '@tanstack/solid-query';
import { err, type Ok, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renameDatabaseTable } from './rename-table';

const transport = vi.hoisted(() => ({ renameTable: vi.fn() }));
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

const original: DatabaseTable = {
  id: 'guests',
  database_id: 'db',
  name: 'Guests',
  position: 'a',
  version: 5,
};
const renamed: DatabaseTable = { ...original, name: 'Attendees', version: 6 };
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
      table: original,
      sql_name: 'guests',
      read_sql_name: 'stable_guests_uuid',
      columns: [],
    },
    {
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
const rowsKey = databasesKeys.rows('db', 'guests').queryKey;
const rows: ExecOutcome = {
  results: [
    {
      columns: [{ name: 'Name', origin: null, entity_type: null }],
      rows: [['Original guest']],
    },
  ],
  changes_applied: 0,
  inserted_row_ids: [],
  new_versions: {},
  read_tables: ['guests'],
  read_versions: { guests: 5 },
  truncated_tables: [],
};

beforeEach(() => {
  vi.resetAllMocks();
  queryClient.setQueryData(key, detail);
  transport.renameTable.mockResolvedValue(ok(renamed));
});
afterEach(() => queryClient.clear());

describe('table rename cache', () => {
  it('passes compare-and-swap identity, updates the named table, and invalidates other catalog schemas', async () => {
    const otherKey = databasesKeys.detail('other-db').queryKey;
    queryClient.setQueryData(otherKey, {
      ...detail,
      database: { ...detail.database, id: 'other-db' },
    });
    await renameDatabaseTable(parameters);
    expect(transport.renameTable).toHaveBeenCalledExactlyOnceWith({
      id: 'db',
      tableId: 'guests',
      name: 'Attendees',
      previousName: 'Guests',
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
    transport.renameTable.mockResolvedValue(
      err([{ code: 'HTTP_ERROR', message: 'Name changed' }])
    );
    await expect(renameDatabaseTable(parameters)).rejects.toThrow(
      'reopen Rename table'
    );
    expect(queryClient.getQueryData(key)).toEqual(detail);
    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(otherKey)?.isInvalidated).toBe(false);
  });

  it('awaits fresh rows and their CAS version, and invalidates only answers that read the renamed table', async () => {
    queryClient.setQueryData(rowsKey, rows);
    const otherRowsKey = databasesKeys.rows('db', 'other').queryKey;
    queryClient.setQueryData(otherRowsKey, rows);
    const answerKey = databaseQueryKeys.answer(
      'SELECT Name FROM stable_guests_uuid'
    ).queryKey;
    queryClient.setQueryData(answerKey, rows);
    const otherAnswerKey = databaseQueryKeys.answer(
      'SELECT Name FROM other'
    ).queryKey;
    queryClient.setQueryData(otherAnswerKey, {
      ...rows,
      read_versions: { other: 5 },
    });
    const latestRows: ExecOutcome = {
      ...rows,
      results: [{ ...rows.results[0], rows: [['Updated guest']] }],
      read_versions: { guests: 7 },
    };
    let resolve!: (value: ExecOutcome) => void;
    const refresh = vi.fn(
      () =>
        new Promise<ExecOutcome>((complete) => {
          resolve = complete;
        })
    );
    const observer = new QueryObserver(queryClient, {
      queryKey: rowsKey,
      queryFn: refresh,
      staleTime: Infinity,
      retry: false,
    });
    const unsubscribe = observer.subscribe(() => {});
    try {
      let completed = false;
      const pending = (async () => {
        await renameDatabaseTable(parameters);
        completed = true;
      })();
      await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
      expect(completed).toBe(false);
      expect(
        queryClient.getQueryData<ExecOutcome>(rowsKey)?.read_versions.guests
      ).toBe(5);
      resolve(latestRows);
      await pending;
      expect(queryClient.getQueryData(rowsKey)).toEqual(latestRows);
      expect(queryClient.getQueryState(otherRowsKey)?.isInvalidated).toBe(
        false
      );
      expect(queryClient.getQueryState(answerKey)?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(otherAnswerKey)?.isInvalidated).toBe(
        false
      );
    } finally {
      unsubscribe();
    }
  });

  it('keeps a committed table rename successful if rows fail to refresh without assigning a newer version to old data', async () => {
    queryClient.setQueryData(rowsKey, rows);
    const refresh = vi.fn(async (): Promise<ExecOutcome> => {
      throw new Error('Offline');
    });
    const observer = new QueryObserver(queryClient, {
      queryKey: rowsKey,
      queryFn: refresh,
      staleTime: Infinity,
      retry: false,
    });
    const unsubscribe = observer.subscribe(() => {});
    try {
      await expect(renameDatabaseTable(parameters)).resolves.toBeUndefined();
      expect(refresh).toHaveBeenCalledOnce();
      expect(
        queryClient.getQueryData<DatabaseDetail>(key)?.tables[0].table.name
      ).toBe('Attendees');
      expect(
        queryClient.getQueryData<ExecOutcome>(rowsKey)?.read_versions.guests
      ).toBe(5);
      expect(queryClient.getQueryState(rowsKey)?.status).toBe('error');
    } finally {
      unsubscribe();
    }
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
      await expect(renameDatabaseTable(parameters)).resolves.toBeUndefined();
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
    let complete!: (value: Ok<DatabaseTable, never>) => void;
    transport.renameTable.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        })
    );
    const pending = renameDatabaseTable(parameters);
    const newer = { ...renamed, name: 'Team attendees', version: 7 };
    queryClient.setQueryData(key, {
      ...detail,
      tables: [{ ...detail.tables[0], table: newer }, detail.tables[1]],
    });
    complete(ok(renamed));
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
