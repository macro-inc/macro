import { queryClient } from '@queries/client';
import { databasesKeys } from '@queries/storage/keys';
import type { DatabaseOpsError } from '@service-storage/databases';
import type { ApplyOpsResponse } from '@service-storage/generated/schemas/applyOpsResponse';
import type { ColumnDetail } from '@service-storage/generated/schemas/columnDetail';
import type { DatabaseDetail } from '@service-storage/generated/schemas/databaseDetail';
import { QueryObserver } from '@tanstack/solid-query';
import {
  err,
  errAsync,
  ok,
  okAsync,
  type Result,
  ResultAsync,
} from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toQuerySchema } from '../../database-query/queries/query-source';
import { renameDatabaseColumn } from './rename-column';
import { toViewColumn } from './table-rows';

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
const column: ColumnDetail = {
  shared_outside_database: false,
  column: {
    id: 'title',
    table_id: 'tasks',
    property_definition_id: 'definition',
    position: 'a',
    config: null,
    display_name: null,
    infer_type: false,
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
      views: [],
      table: {
        id: 'tasks',
        database_id: 'db',
        name: 'Tasks',
        position: 'a',
        version: 5,
      },
      sql_name: 'tasks',
      columns: [column],
    },
  ],
};
const answer: ApplyOpsResponse = {
  results: [
    {
      kind: 'column',
      table: 'tasks',
      column: 'title',
      tableVersion: 6,
      change: { kind: 'renamed' },
    },
  ],
  changes: [],
};
const params = {
  databaseId: 'db',
  tableId: 'tasks',
  columnId: 'title',
  name: 'Task',
  previousName: 'Name',
};
const key = databasesKeys.detail('db').queryKey;
beforeEach(() => {
  vi.resetAllMocks();
  queryClient.setQueryData(key, detail);
  transport.applyOps.mockImplementation(() => okAsync(answer));
});
afterEach(() => queryClient.clear());

describe('column rename cache and labels', () => {
  it('updates only the placement label and version, preserves SQL, and supplies the new label to grid and AI', async () => {
    const otherKey = databasesKeys.detail('other').queryKey;
    queryClient.setQueryData(otherKey, detail);
    expect(await renameDatabaseColumn(params)).toEqual(ok(undefined));
    expect(transport.applyOps).toHaveBeenCalledExactlyOnceWith({
      id: 'db',
      request: {
        ops: [
          {
            kind: 'column',
            table: 'tasks',
            column: 'title',
            change: { kind: 'rename', name: 'Task', previousName: 'Name' },
          },
        ],
      },
    });
    const updated = queryClient.getQueryData<DatabaseDetail>(key)!;
    expect(updated.tables[0].table.version).toBe(6);
    expect(updated.tables[0].columns[0]).toEqual({
      ...column,
      column: { ...column.column, display_name: 'Task' },
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
    const refused: DatabaseOpsError = {
      code: 'INVALID_OP',
      message: 'A column with this name already exists. Choose another name.',
      refusal: {
        message: 'A column with this name already exists. Choose another name.',
        op: 0,
        row: null,
        column: 'title',
        taken: null,
      },
    };
    transport.applyOps.mockImplementation(() => errAsync([refused]));
    expect(await renameDatabaseColumn(params)).toEqual(err(refused));
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
      expect(await renameDatabaseColumn(params)).toEqual(ok(undefined));
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
    let resolve!: (value: Result<ApplyOpsResponse, never>) => void;
    transport.applyOps.mockImplementation(
      () =>
        new ResultAsync(
          new Promise<Result<ApplyOpsResponse, never>>((complete) => {
            resolve = complete;
          })
        )
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
    resolve(ok(answer));
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
