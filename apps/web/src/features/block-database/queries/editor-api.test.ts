import type { DatabaseOp } from '@core/database-sql/generated/types';
import { queryClient } from '@queries/client';
import { databasesKeys } from '@queries/storage/keys';
import type { DatabaseDetail } from '@service-storage/generated/schemas/databaseDetail';
import { errAsync, okAsync, ResultAsync } from 'neverthrow';
import { afterEach, expect, it, vi } from 'vitest';
import { RENAME_DETAIL } from '../browser-test/rename-data';
import { createMacroDatabaseApi } from './editor-api';

const service = vi.hoisted(() => ({ applyOps: vi.fn(), get: vi.fn() }));
vi.mock('@service-storage/client', () => ({
  storageServiceClient: { databases: service },
}));
vi.mock('@queries/database-sql/create-database-sql-query', () => ({
  readDatabaseSql: vi.fn(),
}));
vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return {
    queryClient: new QueryClient({
      defaultOptions: { queries: { retry: false } },
    }),
  };
});
const KEY = databasesKeys.detail('db').queryKey;
const OPS: DatabaseOp[] = [
  {
    kind: 'column',
    table: 'tasks',
    column: 'name',
    change: { kind: 'rename', name: 'Task', previousName: 'Name' },
  },
];
const cachedName = () =>
  queryClient.getQueryData<DatabaseDetail>(KEY)?.tables[0].columns[0].column
    .display_name;
afterEach(() => {
  queryClient.clear();
  vi.resetAllMocks();
});

it('cancels an older schema read and shows the new column name before the response', async () => {
  queryClient.setQueryData(KEY, RENAME_DETAIL);
  let releaseRead!: (detail: DatabaseDetail) => void;
  const reading = queryClient.fetchQuery({
    queryKey: KEY,
    staleTime: 0,
    queryFn: () =>
      new Promise<DatabaseDetail>((resolve) => {
        releaseRead = resolve;
      }),
  });
  let releaseWrite!: () => void;
  const submitted = new Promise<void>((resolveSubmitted) => {
    service.applyOps.mockImplementation(() => {
      expect(cachedName()).toBe('Task');
      resolveSubmitted();
      return ResultAsync.fromSafePromise(
        new Promise<void>((resolve) => {
          releaseWrite = resolve;
        })
      ).map(() => ({ results: [], changes: [] }));
    });
  });
  const api = createMacroDatabaseApi('db', queryClient);
  const writing = api.applyOps({ ops: OPS });
  await submitted;
  expect(await reading).toEqual(RENAME_DETAIL);
  releaseRead(RENAME_DETAIL);
  releaseWrite();
  expect((await writing).isOk()).toBe(true);
  expect(cachedName()).toBe('Task');
});

it('restores the previous schema when a rename is refused', async () => {
  queryClient.setQueryData(KEY, RENAME_DETAIL);
  service.applyOps.mockImplementation(() => {
    expect(cachedName()).toBe('Task');
    return errAsync([{ code: 'FORBIDDEN', refusal: null, message: 'Refused' }]);
  });
  const result = await createMacroDatabaseApi('db', queryClient).applyOps({
    ops: OPS,
  });
  expect(result.isErr()).toBe(true);
  expect(cachedName()).toBeNull();
});

it('keeps a newer cached edit when an older rename is refused', async () => {
  queryClient.setQueryData(KEY, RENAME_DETAIL);
  service.applyOps.mockImplementation(() => {
    queryClient.setQueryData(
      KEY,
      (current: DatabaseDetail | undefined) =>
        current && {
          ...current,
          database: { ...current.database, name: 'Roadmap' },
        }
    );
    return errAsync([{ code: 'CONFLICT', refusal: null, message: 'Refused' }]);
  });
  await createMacroDatabaseApi('db', queryClient).applyOps({ ops: OPS });
  expect(queryClient.getQueryData<DatabaseDetail>(KEY)?.database.name).toBe(
    'Roadmap'
  );
  expect(cachedName()).toBeNull();
});

it('does not undo a newer column rename when an older request is refused', async () => {
  queryClient.setQueryData(KEY, RENAME_DETAIL);
  service.applyOps.mockImplementation(() => {
    queryClient.setQueryData(
      KEY,
      (current: DatabaseDetail | undefined) =>
        current && {
          ...current,
          tables: current.tables.map((table) => ({
            ...table,
            columns: table.columns.map((column) => ({
              ...column,
              column: { ...column.column, display_name: 'Latest' },
            })),
          })),
        }
    );
    return errAsync([{ code: 'CONFLICT', refusal: null, message: 'Refused' }]);
  });
  await createMacroDatabaseApi('db', queryClient).applyOps({ ops: OPS });
  expect(cachedName()).toBe('Latest');
});

it('sends other operations without cancelling schema reads', async () => {
  const cancel = vi.spyOn(queryClient, 'cancelQueries');
  service.applyOps.mockReturnValue(okAsync({ results: [], changes: [] }));
  await createMacroDatabaseApi('db', queryClient).applyOps({ ops: [] });
  expect(cancel).not.toHaveBeenCalled();
  cancel.mockRestore();
});
