import { queryClient } from '@queries/client';
import type { DatabaseDetail, ExecOutcome } from '@service-storage/databases';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyDatabaseTableVersions } from './databases';
import { databasesKeys } from './keys';

vi.mock('@app/lib/analytics', () => ({ analytics: { track: vi.fn() } }));
vi.mock('@service-storage/client', () => ({ storageServiceClient: {} }));
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
const rowsKey = databasesKeys.rows('db', 'tasks').queryKey;
const rows: ExecOutcome = {
  results: [],
  changes_applied: 0,
  inserted_row_ids: [],
  new_versions: {},
  read_tables: ['tasks'],
  read_versions: { tasks: 5 },
  truncated_tables: [],
};

afterEach(() => queryClient.clear());

describe('database write version acknowledgments', () => {
  it('preserves a newer schema refresh when an older write response arrives later', async () => {
    queryClient.setQueryData(key, detail);
    queryClient.setQueryData(rowsKey, rows);
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
    // A schema acknowledgment cannot certify an older rows snapshot.
    expect(queryClient.getQueryData(rowsKey)).toEqual(rows);
  });

  it('advances only the acknowledged table and leaves rows at their actual read version', () => {
    queryClient.setQueryData(key, detail);
    queryClient.setQueryData(rowsKey, rows);
    applyDatabaseTableVersions('db', { tasks: 6, unknown: 10 });
    const updated = queryClient.getQueryData<DatabaseDetail>(key)!;
    expect(updated.tables[0]).toEqual({
      ...detail.tables[0],
      table: { ...detail.tables[0].table, version: 6 },
    });
    expect(updated.tables[1]).toEqual(detail.tables[1]);
    expect(queryClient.getQueryData(rowsKey)).toEqual(rows);
  });
});
