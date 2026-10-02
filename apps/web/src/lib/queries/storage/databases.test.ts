import { queryClient } from '@queries/client';
import type { DatabaseDetail } from '@service-storage/generated/schemas/databaseDetail';
import { errAsync, okAsync } from 'neverthrow';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyDatabaseOps,
  applyDatabaseTableVersions,
  createDatabase,
  fetchViewerDatabases,
  onDatabaseBatchCommitted,
} from './databases';
import { databasesKeys } from './keys';

const mock = vi.hoisted(() => ({
  applyOps: vi.fn(),
  create: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
  track: vi.fn(),
}));
vi.mock('@app/lib/analytics', () => ({ analytics: { track: mock.track } }));
vi.mock('@service-storage/client', () => ({
  storageServiceClient: {
    databases: {
      applyOps: mock.applyOps,
      create: mock.create,
      list: mock.list,
      get: mock.get,
    },
  },
}));
vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return {
    queryClient: new QueryClient({
      defaultOptions: { queries: { retry: false } },
    }),
  };
});

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
      table: {
        id: 'tasks',
        database_id: 'db',
        name: 'Tasks',
        position: 'a',
        version: 5,
      },
      sql_name: 'tasks',
      columns: [],
    },
    {
      views: [],
      table: {
        id: 'people',
        database_id: 'db',
        name: 'People',
        position: 'b',
        version: 3,
      },
      sql_name: 'people',
      columns: [],
    },
  ],
};
const key = databasesKeys.detail('db').queryKey;

afterEach(() => {
  queryClient.clear();
  vi.clearAllMocks();
});

describe('database write version acknowledgments', () => {
  it('preserves a newer schema refresh when an older write response arrives later', async () => {
    queryClient.setQueryData(key, detail);
    let acknowledge!: (versions: Record<string, number>) => void;
    const response = new Promise<Record<string, number>>((resolve) => {
      acknowledge = resolve;
    });
    const pendingWrite = (async () => {
      applyDatabaseTableVersions('db', await response);
    })();

    // A concurrent rename is already visible before our own write responds.
    const refreshed: DatabaseDetail = {
      ...detail,
      tables: detail.tables.map((entry) =>
        entry.table.id === 'tasks'
          ? {
              ...entry,
              table: { ...entry.table, name: 'Roadmap', version: 8 },
              sql_name: 'roadmap',
            }
          : entry
      ),
    };
    queryClient.setQueryData(key, refreshed);
    acknowledge({ tasks: 7 });
    await pendingWrite;

    expect(queryClient.getQueryData(key)).toEqual(refreshed);
  });

  it('advances only the acknowledged table', () => {
    queryClient.setQueryData(key, detail);
    applyDatabaseTableVersions('db', { tasks: 6, unknown: 10 });
    const updated = queryClient.getQueryData<DatabaseDetail>(key)!;
    expect(updated.tables[0]).toEqual({
      ...detail.tables[0],
      table: { ...detail.tables[0].table, version: 6 },
    });
    expect(updated.tables[1]).toEqual(detail.tables[1]);
  });
});

describe('applying ops', () => {
  it('sends the base versions with the batch and returns its results', async () => {
    mock.applyOps.mockReturnValue(
      okAsync({
        results: [
          {
            kind: 'column',
            table: 'tasks',
            column: 'status',
            tableVersion: 6,
            change: { kind: 'deleted' },
          },
        ],
        changes: [],
      })
    );

    const applied = await applyDatabaseOps(
      'db',
      [
        {
          kind: 'column',
          table: 'tasks',
          column: 'status',
          change: { kind: 'delete' },
        },
      ],
      { tasks: 5 }
    );

    expect(applied._unsafeUnwrap()).toEqual([
      {
        kind: 'column',
        table: 'tasks',
        column: 'status',
        tableVersion: 6,
        change: { kind: 'deleted' },
      },
    ]);
    expect(mock.applyOps).toHaveBeenCalledExactlyOnceWith({
      id: 'db',
      request: {
        ops: [
          {
            kind: 'column',
            table: 'tasks',
            column: 'status',
            change: { kind: 'delete' },
          },
        ],
        baseVersions: { tasks: 5 },
      },
    });
  });

  it('hands back the first refusal of a refused batch', async () => {
    mock.applyOps.mockReturnValue(
      errAsync([
        {
          code: 'CONFLICT',
          message: 'The table changed.',
          refusal: null,
        },
      ])
    );

    const applied = await applyDatabaseOps('db', [
      { kind: 'table', table: 'tasks', change: { kind: 'delete' } },
    ]);

    expect(applied._unsafeUnwrapErr()).toEqual({
      code: 'CONFLICT',
      message: 'The table changed.',
      refusal: null,
    });
    expect(mock.applyOps).toHaveBeenCalledExactlyOnceWith({
      id: 'db',
      request: {
        ops: [{ kind: 'table', table: 'tasks', change: { kind: 'delete' } }],
      },
    });
  });
});

describe('creating a database', () => {
  it('asks the service once and returns the new id', async () => {
    mock.create.mockReturnValue(
      okAsync({
        id: 'db',
        name: 'Untitled database',
        owner_id: 'owner',
        created_at: '',
        trashed_at: null,
      })
    );

    const created = await createDatabase({
      name: 'Untitled database',
      source: 'launcher',
    });

    expect(created._unsafeUnwrap()).toBe('db');
    expect(mock.create).toHaveBeenCalledWith({ name: 'Untitled database' });
    expect(mock.get).not.toHaveBeenCalled();
    expect(mock.track).toHaveBeenCalledWith('create_entity', {
      entityType: 'database',
      entityId: 'db',
      source: 'launcher',
    });
  });

  it('hands a refusal back to the caller', async () => {
    mock.create.mockReturnValue(
      errAsync([{ code: 'INVALID_SCHEMA', message: 'name is empty' }])
    );

    const created = await createDatabase({ name: '' });

    expect(created._unsafeUnwrapErr()).toEqual([
      { code: 'INVALID_SCHEMA', message: 'name is empty' },
    ]);
    expect(mock.track).not.toHaveBeenCalled();
  });
});

describe('reading every viewer database once', () => {
  it('reads each live database and skips the trashed', async () => {
    mock.list.mockReturnValue(
      okAsync([
        {
          database: {
            id: 'db',
            name: 'Planning',
            owner_id: 'owner',
            created_at: '',
            trashed_at: null,
          },
          grant: 'owner',
          tables: [],
        },
        {
          database: {
            id: 'old',
            name: 'Archive',
            owner_id: 'owner',
            created_at: '',
            trashed_at: '2026-09-01T00:00:00Z',
          },
          grant: 'owner',
          tables: [],
        },
      ])
    );
    mock.get.mockReturnValue(okAsync(detail));

    const databases = await fetchViewerDatabases();

    expect(databases._unsafeUnwrap()).toEqual([detail]);
    expect(mock.get).toHaveBeenCalledWith({ id: 'db' });
    expect(mock.get).toHaveBeenCalledTimes(1);
  });

  it('returns the failure a detail read gave', async () => {
    mock.list.mockReturnValue(
      okAsync([
        {
          database: {
            id: 'db',
            name: 'Planning',
            owner_id: 'owner',
            created_at: '',
            trashed_at: null,
          },
          grant: 'owner',
          tables: [],
        },
      ])
    );
    mock.get.mockReturnValue(
      errAsync([{ code: 'FORBIDDEN', message: 'no access' }])
    );

    const databases = await fetchViewerDatabases();

    expect(databases._unsafeUnwrapErr()).toEqual([
      { code: 'FORBIDDEN', message: 'no access' },
    ]);
  });
});

describe('shared ops cache effects', () => {
  it('applies repeated schema edits in batch order and advances the version once', async () => {
    queryClient.setQueryData(key, detail);
    mock.applyOps.mockReturnValue(
      okAsync({
        results: [
          {
            kind: 'table',
            table: 'tasks',
            tableVersion: 6,
            change: { kind: 'renamed' },
          },
          {
            kind: 'table',
            table: 'tasks',
            tableVersion: 6,
            change: { kind: 'renamed' },
          },
        ],
        changes: [],
      })
    );
    await applyDatabaseOps('db', [
      {
        kind: 'table',
        table: 'tasks',
        change: { kind: 'rename', name: 'First', previousName: 'Tasks' },
      },
      {
        kind: 'table',
        table: 'tasks',
        change: { kind: 'rename', name: 'Final', previousName: 'First' },
      },
    ]);
    expect(
      queryClient.getQueryData<DatabaseDetail>(key)?.tables[0].table
    ).toMatchObject({ name: 'Final', version: 6 });
  });
  it('deletes a table and invalidates dependent catalogs for every ops caller', async () => {
    queryClient.setQueryData(key, detail);
    const other = databasesKeys.detail('other').queryKey;
    queryClient.setQueryData(other, detail);
    mock.applyOps.mockReturnValue(
      okAsync({
        results: [
          {
            kind: 'table',
            table: 'tasks',
            change: { kind: 'deleted' },
          },
        ],
        changes: [{ table: 'tasks', version: 6, change: 1 }],
      })
    );
    await applyDatabaseOps('db', [
      { kind: 'table', table: 'tasks', change: { kind: 'delete' } },
    ]);
    expect(
      queryClient
        .getQueryData<DatabaseDetail>(key)
        ?.tables.map(({ table }) => table.id)
    ).toEqual(['people']);
    expect(queryClient.getQueryState(other)?.isInvalidated).toBe(true);
  });
  it('advances ordinary row writes without refetching the schema for each cell', async () => {
    queryClient.setQueryData(key, detail);
    mock.applyOps.mockReturnValue(
      okAsync({
        results: [],
        changes: [{ table: 'tasks', version: 6, change: 1 }],
      })
    );
    await applyDatabaseOps('db', [
      {
        kind: 'rows',
        table: 'tasks',
        change: { kind: 'delete', rows: ['row'] },
      },
    ]);
    expect(
      queryClient.getQueryData<DatabaseDetail>(key)?.tables[0].table.version
    ).toBe(6);
    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false);
  });
  it('invalidates optimistic state after a refused batch', async () => {
    queryClient.setQueryData(key, detail);
    mock.applyOps.mockReturnValue(
      errAsync([{ code: 'CONFLICT', message: 'Changed', refusal: null }])
    );
    const result = await applyDatabaseOps('db', [
      { kind: 'table', table: 'tasks', change: { kind: 'delete' } },
    ]);
    expect(result.isErr()).toBe(true);
    expect(queryClient.getQueryData(key)).toEqual(detail);
    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
  });
});

it('announces a schema commit before its slow refresh and a later row commit', async () => {
  const events: number[] = [];
  const unsubscribe = onDatabaseBatchCommitted((batch) =>
    events.push(batch.changes[0].change)
  );
  let release!: () => void;
  const refresh = new Promise<void>((resolve) => {
    release = resolve;
  });
  const invalidation = vi
    .spyOn(queryClient, 'invalidateQueries')
    .mockImplementationOnce(() => refresh);
  mock.applyOps
    .mockReturnValueOnce(
      okAsync({
        results: [],
        changes: [{ table: 'tasks', version: 6, change: 10 }],
      })
    )
    .mockReturnValueOnce(
      okAsync({
        results: [],
        changes: [{ table: 'tasks', version: 7, change: 11 }],
      })
    );
  try {
    const schema = applyDatabaseOps('db', [
      {
        kind: 'table',
        table: 'tasks',
        change: { kind: 'rename', name: 'Renamed', previousName: 'Tasks' },
      },
    ]);
    await vi.waitFor(() => expect(invalidation).toHaveBeenCalled());
    await applyDatabaseOps('db', [
      {
        kind: 'rows',
        table: 'tasks',
        change: { kind: 'delete', rows: ['row'] },
      },
    ]);
    expect(events).toEqual([10, 11]);
    release();
    expect((await schema).isOk()).toBe(true);
  } finally {
    release();
    unsubscribe();
    invalidation.mockRestore();
  }
});
