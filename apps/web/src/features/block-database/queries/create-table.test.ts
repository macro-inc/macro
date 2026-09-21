import { queryClient } from '@queries/client';
import { databasesKeys } from '@queries/storage/keys';
import type {
  DatabaseColumnDetail,
  DatabaseDetail,
} from '@service-storage/databases';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTableWithName } from './create-table';

const transport = vi.hoisted(() => ({
  createTable: vi.fn(),
  createColumn: vi.fn(),
  get: vi.fn(),
}));
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

const name: DatabaseColumnDetail = {
  column: {
    id: 'name',
    table_id: 'projects',
    property_definition_id: 'definition',
    position: 'a',
    config: null,
  },
  sql_name: 'Name',
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
function detail(columns: DatabaseColumnDetail[]): DatabaseDetail {
  return {
    database: {
      id: 'db',
      name: 'Workspace',
      owner_id: 'owner',
      created_at: '',
      trashed_at: null,
    },
    grant: 'owner',
    tables: [
      {
        table: {
          id: 'projects',
          database_id: 'db',
          name: 'Projects',
          position: 'a',
          version: columns.length,
        },
        sql_name: 'Workspace.Projects',
        columns,
      },
    ],
  };
}
const failure = err([{ code: 'HTTP_ERROR', message: 'Connection lost' }]);

beforeEach(() => {
  vi.resetAllMocks();
  transport.createTable.mockResolvedValue(ok(detail([]).tables[0].table));
  transport.createColumn.mockResolvedValue(ok({ columnId: 'name' }));
  transport.get.mockResolvedValue(ok(detail([name])));
});
afterEach(() => queryClient.clear());

describe('table setup', () => {
  it('creates a Name column and loads the ready table into the shared schema cache', async () => {
    const result = await createTableWithName({
      databaseId: 'db',
      name: 'Projects',
    });
    expect(result).toEqual({ tableId: 'projects', ready: true });
    expect(transport.createColumn).toHaveBeenCalledWith({
      id: 'db',
      tableId: 'projects',
      request: {
        binding: {
          kind: 'new',
          name: 'Name',
          data_type: 'STRING',
          is_multi_select: false,
        },
      },
    });
    expect(
      queryClient.getQueryData(databasesKeys.detail('db').queryKey)
    ).toEqual(detail([name]));
  });

  it('retries failed Name setup on the existing table without creating a duplicate', async () => {
    transport.createColumn.mockResolvedValueOnce(failure);
    const first = await createTableWithName({
      databaseId: 'db',
      name: 'Projects',
    });
    expect(first).toMatchObject({ tableId: 'projects', ready: false });
    transport.get.mockResolvedValueOnce(ok(detail([])));
    const retried = await createTableWithName({
      databaseId: 'db',
      name: 'Projects',
      existingTableId: first.tableId,
    });
    expect(retried).toEqual({ tableId: 'projects', ready: true });
    expect(transport.createTable).toHaveBeenCalledTimes(1);
    expect(transport.createColumn).toHaveBeenCalledTimes(2);
  });

  it('does not recreate Name when its successful write was followed by a failed refresh', async () => {
    transport.get.mockResolvedValueOnce(failure);
    const first = await createTableWithName({
      databaseId: 'db',
      name: 'Projects',
    });
    expect(first).toMatchObject({ tableId: 'projects', ready: false });
    const retried = await createTableWithName({
      databaseId: 'db',
      name: 'Projects',
      existingTableId: first.tableId,
    });
    expect(retried).toEqual({ tableId: 'projects', ready: true });
    expect(transport.createTable).toHaveBeenCalledTimes(1);
    expect(transport.createColumn).toHaveBeenCalledTimes(1);
  });
});
