import { queryClient } from '@queries/client';
import { databaseQueryKeys, databasesKeys } from '@queries/storage/keys';
import type {
  DatabaseColumnDetail,
  DatabaseDetail,
  ExecOutcome,
  RenameColumnOutcome,
} from '@service-storage/databases';
import { QueryObserver } from '@tanstack/solid-query';
import { err, type Ok, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toQuerySchema } from '../../database-query/queries/query-source';
import { renameDatabaseColumn } from './rename-column';
import { toViewColumn } from './table-rows';

const transport = vi.hoisted(() => ({ renameColumn: vi.fn() }));
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
const column: DatabaseColumnDetail = {
  column: {
    id: 'title',
    table_id: 'tasks',
    property_definition_id: 'definition',
    position: 'a',
    config: null,
  },
  sql_name: 'name',
  writable: true,
  definition: {
    definition: {
      id: 'definition',
      owner: { scope: 'database', database_id: 'db' },
      display_name: 'Name',
      data_type: 'STRING',
      is_multi_select: false,
      specific_entity_type: null,
      created_at: '',
      updated_at: '',
      is_system: false,
      is_metadata: false,
    },
    property_options: [],
  },
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
      table: {
        id: 'tasks',
        database_id: 'db',
        name: 'Tasks',
        position: 'a',
        version: 5,
      },
      sql_name: 'tasks',
      read_sql_name: 'stable_tasks',
      columns: [column],
    },
  ],
};
const renamed: RenameColumnOutcome = {
  column: { ...column.column, display_name: 'Task' },
  table_version: 6,
};
const params = {
  databaseId: 'db',
  tableId: 'tasks',
  columnId: 'title',
  name: 'Task',
  previousName: 'Name',
};
const key = databasesKeys.detail('db').queryKey;
const rowsKey = databasesKeys.rows('db', 'tasks').queryKey;
const rows: ExecOutcome = {
  results: [
    {
      columns: [{ name: 'name', origin: null, entity_type: null }],
      rows: [['Original task']],
    },
  ],
  changes_applied: 0,
  inserted_row_ids: [],
  new_versions: {},
  read_tables: ['tasks'],
  read_versions: { tasks: 5 },
  truncated_tables: [],
};
beforeEach(() => {
  vi.resetAllMocks();
  queryClient.setQueryData(key, detail);
  transport.renameColumn.mockResolvedValue(ok(renamed));
});
afterEach(() => queryClient.clear());

describe('column rename cache and labels', () => {
  it('refreshes the edited table snapshot and dependent answers before completing so the next write sees its current CAS version', async () => {
    queryClient.setQueryData(rowsKey, rows);
    const otherRowsKey = databasesKeys.rows('db', 'other').queryKey;
    queryClient.setQueryData(otherRowsKey, rows);
    const answerKey = databaseQueryKeys.answer(
      'SELECT name FROM tasks'
    ).queryKey;
    queryClient.setQueryData(answerKey, rows);
    const otherAnswerKey = databaseQueryKeys.answer(
      'SELECT name FROM other'
    ).queryKey;
    queryClient.setQueryData(otherAnswerKey, {
      ...rows,
      read_versions: { other: 5 },
    });
    // An intervening edit means the rename response alone cannot certify old rows.
    const latestRows: ExecOutcome = {
      ...rows,
      results: [{ ...rows.results[0], rows: [['Changed elsewhere']] }],
      read_versions: { tasks: 7 },
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
        await renameDatabaseColumn(params);
        completed = true;
      })();
      await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
      expect(completed).toBe(false);
      expect(
        queryClient.getQueryData<ExecOutcome>(rowsKey)?.read_versions.tasks
      ).toBe(5);
      resolve(latestRows);
      await pending;
      expect(queryClient.getQueryData<ExecOutcome>(rowsKey)).toEqual(
        latestRows
      );
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

  it('retains a successful rename when rows cannot refresh and does not certify stale rows with the rename version', async () => {
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
      await expect(renameDatabaseColumn(params)).resolves.toBeUndefined();
      expect(refresh).toHaveBeenCalledOnce();
      expect(
        queryClient.getQueryData<DatabaseDetail>(key)?.tables[0].columns[0]
          .column.display_name
      ).toBe('Task');
      expect(
        queryClient.getQueryData<ExecOutcome>(rowsKey)?.read_versions.tasks
      ).toBe(5);
      expect(queryClient.getQueryState(rowsKey)?.status).toBe('error');
    } finally {
      unsubscribe();
    }
  });

  it('updates only the placement label and version, preserves SQL, and supplies the new label to grid and AI', async () => {
    const otherKey = databasesKeys.detail('other').queryKey;
    queryClient.setQueryData(otherKey, detail);
    await renameDatabaseColumn(params);
    expect(transport.renameColumn).toHaveBeenCalledExactlyOnceWith({
      id: 'db',
      tableId: 'tasks',
      columnId: 'title',
      name: 'Task',
      previousName: 'Name',
    });
    const updated = queryClient.getQueryData<DatabaseDetail>(key)!;
    expect(updated.tables[0].table.version).toBe(6);
    expect(updated.tables[0].columns[0]).toEqual({
      ...column,
      column: renamed.column,
    });
    expect(toViewColumn(updated.tables[0].columns[0]).name).toBe('Task');
    expect(toQuerySchema(updated).tables[0].columns[0]).toMatchObject({
      name: 'Task',
      sqlName: 'name',
    });
    expect(toQuerySchema(detail).tables[0].columns[0]).toMatchObject({
      name: 'Name',
      sqlName: 'name',
    });
    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(otherKey)?.isInvalidated).toBe(false);
  });
  it('retains the server validation reason without changing a failed rename in cache', async () => {
    transport.renameColumn.mockResolvedValue(
      err([
        {
          code: 'INVALID_SCHEMA',
          message:
            'A column with this name already exists. Choose another name.',
        },
      ])
    );
    await expect(renameDatabaseColumn(params)).rejects.toThrow(
      'already exists'
    );
    expect(queryClient.getQueryData(key)).toEqual(detail);
    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
  });
  it('keeps a committed rename successful when schema refresh fails', async () => {
    const refresh = vi.fn(async (): Promise<DatabaseDetail> => {
      throw new Error('Offline');
    });
    const observer = new QueryObserver(queryClient, {
      queryKey: key,
      queryFn: refresh,
      staleTime: Infinity,
      retry: false,
    });
    const unsubscribe = observer.subscribe(() => {});
    try {
      await expect(renameDatabaseColumn(params)).resolves.toBeUndefined();
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(
        queryClient.getQueryData<DatabaseDetail>(key)?.tables[0].columns[0]
          .column.display_name
      ).toBe('Task');
      expect(queryClient.getQueryState(key)?.status).toBe('error');
    } finally {
      unsubscribe();
    }
  });
  it('does not overwrite a newer label/version with a delayed rename response', async () => {
    let resolve!: (value: Ok<RenameColumnOutcome, never>) => void;
    transport.renameColumn.mockImplementation(
      () =>
        new Promise((complete) => {
          resolve = complete;
        })
    );
    const pending = renameDatabaseColumn(params);
    const newer = {
      ...detail,
      tables: [
        {
          ...detail.tables[0],
          table: { ...detail.tables[0].table, version: 7 },
          columns: [
            {
              ...column,
              column: { ...column.column, display_name: 'Work item' },
            },
          ],
        },
      ],
    };
    queryClient.setQueryData(key, newer);
    resolve(ok(renamed));
    await pending;
    expect(queryClient.getQueryData(key)).toEqual(newer);
  });
  it('cancels an older inactive schema fetch so it cannot undo the committed label', async () => {
    let resolve!: (value: DatabaseDetail) => void;
    const fetched = queryClient.fetchQuery({
      queryKey: key,
      queryFn: () =>
        new Promise<DatabaseDetail>((complete) => {
          resolve = complete;
        }),
      staleTime: 0,
    });
    const settled = Promise.allSettled([fetched]);
    await renameDatabaseColumn(params);
    resolve(detail);
    await settled;
    expect(
      queryClient.getQueryData<DatabaseDetail>(key)?.tables[0].columns[0].column
        .display_name
    ).toBe('Task');
  });
});
