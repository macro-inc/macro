import { queryClient } from '@queries/client';
import { databasesKeys } from '@queries/storage/keys';
import type { ColumnDetail } from '@service-storage/generated/schemas/columnDetail';
import type { DatabaseDetail } from '@service-storage/generated/schemas/databaseDetail';
import { err, errAsync, ok, okAsync } from 'neverthrow';
import {
  afterEach,
  assert,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { createTableWithName } from './create-table';

const transport = vi.hoisted(() => ({
  applyOps: vi.fn(),
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

const name: ColumnDetail = {
  shared_outside_database: false,
  column: {
    id: 'name',
    table_id: 'projects',
    property_definition_id: 'definition',
    position: 'a',
    config: null,
    display_name: null,
    infer_type: false,
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
function detail(columns: ColumnDetail[]): DatabaseDetail {
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
        views: [],
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
const uuidv7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

beforeEach(() => {
  vi.resetAllMocks();
  transport.applyOps.mockImplementation(() =>
    okAsync({
      results: [
        {
          kind: 'table',
          table: 'projects',
          tableVersion: 1,
          change: { kind: 'created' },
        },
        {
          kind: 'column',
          table: 'projects',
          column: 'name',
          tableVersion: 1,
          change: { kind: 'created' },
        },
      ],
      changes: [],
    })
  );
  transport.get.mockImplementation(() => okAsync(detail([name])));
});
afterEach(() => queryClient.clear());

describe('table setup', () => {
  it('creates the table and its inferring Name column in one batch under minted ids, then loads it', async () => {
    const result = await createTableWithName({
      databaseId: 'db',
      name: 'Projects',
    });

    expect(transport.applyOps).toHaveBeenCalledTimes(1);
    const [{ id, request }] = transport.applyOps.mock.calls[0];
    const [table, column] = request.ops;
    assert(table?.kind === 'table' && column?.kind === 'column');
    expect(id).toBe('db');
    expect(request.ops).toEqual([
      {
        kind: 'table',
        table: expect.stringMatching(uuidv7),
        change: { kind: 'create', name: 'Projects' },
      },
      {
        kind: 'column',
        table: table.table,
        column: expect.stringMatching(uuidv7),
        change: {
          kind: 'create',
          definition: {
            source: 'new',
            name: 'Name',
            type: { type: 'text' },
            inferType: true,
          },
        },
      },
    ]);
    expect(column.column).not.toBe(table.table);
    expect(result).toEqual(ok({ tableId: table.table, ready: true }));
    expect(
      queryClient.getQueryData(databasesKeys.detail('db').queryKey)
    ).toEqual(detail([name]));
  });

  it('hands back a refused batch, which created nothing', async () => {
    const refused = {
      code: 'INVALID_OP',
      message: 'A table named Projects already exists.',
      refusal: {
        message: 'A table named Projects already exists.',
        op: 0,
        row: null,
        column: null,
        taken: null,
      },
    };
    transport.applyOps.mockImplementation(() => errAsync([refused]));

    const result = await createTableWithName({
      databaseId: 'db',
      name: 'Projects',
    });

    expect(result).toEqual(err(refused));
    expect(transport.get).not.toHaveBeenCalled();
  });

  it('loads a committed table again on retry without creating another', async () => {
    transport.get.mockImplementationOnce(() =>
      errAsync([{ code: 'HTTP_ERROR', message: 'Connection lost' }])
    );
    const first = await createTableWithName({
      databaseId: 'db',
      name: 'Projects',
    });
    const firstSetup = first._unsafeUnwrap();
    expect(firstSetup).toMatchObject({ ready: false });

    const retried = await createTableWithName({
      databaseId: 'db',
      name: 'Projects',
      existingTableId: firstSetup.tableId,
    });

    expect(retried).toEqual(ok({ tableId: firstSetup.tableId, ready: true }));
    expect(transport.applyOps).toHaveBeenCalledTimes(1);
  });
});
