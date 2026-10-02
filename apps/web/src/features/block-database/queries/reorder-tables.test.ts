import { queryClient } from '@queries/client';
import { databasesKeys } from '@queries/storage/keys';
import type { DatabaseOpsError } from '@service-storage/databases';
import type { DatabaseDetail } from '@service-storage/generated/schemas/databaseDetail';
import type { OpResult } from '@service-storage/generated/schemas/opResult';
import { err, ok, type Result, ResultAsync } from 'neverthrow';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { reorderDatabaseTables } from './reorder-tables';

const storage = vi.hoisted(() => ({
  applyDatabaseOps: vi.fn(),
  invalidateDatabase: vi.fn(),
}));
vi.mock('@queries/storage/databases', () => storage);
vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return {
    queryClient: new QueryClient({
      defaultOptions: { queries: { retry: false } },
    }),
  };
});

afterEach(() => {
  queryClient.clear();
  vi.resetAllMocks();
});

const detail: DatabaseDetail = {
  database: {
    id: 'db',
    name: 'Party Planner',
    owner_id: 'owner',
    created_at: '',
    trashed_at: null,
  },
  grant: 'owner',
  tables: [
    {
      table: {
        id: 'invites',
        database_id: 'db',
        name: 'Invites',
        position: 'a',
        version: 3,
      },
      sql_name: '"Invites"',
      columns: [],
      views: [],
    },
    {
      table: {
        id: 'venues',
        database_id: 'db',
        name: 'Venues',
        position: 'b',
        version: 1,
      },
      sql_name: '"Venues"',
      columns: [],
      views: [],
    },
  ],
};

describe('reordering tables', () => {
  it('puts back only the tab order when the move is refused, keeping a rename made meanwhile', async () => {
    const key = databasesKeys.detail('db').queryKey;
    queryClient.setQueryData(key, detail);
    const { promise: answered, resolve: answer } =
      Promise.withResolvers<Result<OpResult[], DatabaseOpsError>>();
    storage.applyDatabaseOps.mockReturnValue(new ResultAsync(answered));

    const reordered = reorderDatabaseTables({
      databaseId: 'db',
      tableIds: ['venues', 'invites'],
    });
    await vi.waitFor(() =>
      expect(storage.applyDatabaseOps).toHaveBeenCalledExactlyOnceWith('db', [
        { kind: 'reorder_tables', order: ['venues', 'invites'] },
      ])
    );
    queryClient.setQueryData(key, (current: DatabaseDetail | undefined) =>
      current
        ? {
            ...current,
            tables: current.tables.map((entry) =>
              entry.table.id === 'invites'
                ? { ...entry, table: { ...entry.table, name: 'Guests' } }
                : entry
            ),
          }
        : current
    );
    answer(
      err({
        code: 'FORBIDDEN',
        message: 'Owner access required',
        refusal: null,
      })
    );

    expect((await reordered).isErr()).toBe(true);
    expect(
      queryClient
        .getQueryData<DatabaseDetail>(key)
        ?.tables.map((entry) => entry.table.name)
    ).toEqual(['Guests', 'Venues']);
    expect(storage.invalidateDatabase).toHaveBeenCalledExactlyOnceWith('db');
  });

  it('takes each table’s committed version from the answer', async () => {
    const key = databasesKeys.detail('db').queryKey;
    queryClient.setQueryData(key, detail);
    storage.applyDatabaseOps.mockReturnValue(
      new ResultAsync(
        Promise.resolve(
          ok([
            {
              kind: 'reorder_tables',
              tables: [
                { table: 'venues', version: 2 },
                { table: 'invites', version: 4 },
              ],
            },
          ])
        )
      )
    );

    const reordered = await reorderDatabaseTables({
      databaseId: 'db',
      tableIds: ['venues', 'invites'],
    });

    expect(reordered.isOk()).toBe(true);
    expect(
      queryClient
        .getQueryData<DatabaseDetail>(key)
        ?.tables.map((entry) => [entry.table.id, entry.table.version])
    ).toEqual([
      ['venues', 2],
      ['invites', 4],
    ]);
    expect(storage.invalidateDatabase).not.toHaveBeenCalled();
  });
});
