import { databasesKeys } from '@queries/storage/keys';
import type {
  DatabaseDetail,
  ExecOutcome,
  ExecRequest,
} from '@service-storage/databases';
import { cleanup, render, waitFor } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type DatabaseRowsSource,
  DatabaseWriteOutcomeUnknown,
} from '../context/table-source';
import type { DatabaseRowMutation } from '../core/table';
import { createDraftRows } from '../primitives/draft-rows';
import { createTableController } from '../primitives/table-controller';
import { createDatabaseRowsSource } from './table-rows';

const transport = vi.hoisted(() => ({
  get: vi.fn(),
  inferColumnType: vi.fn(),
}));
vi.mock('@service-storage/client', () => ({
  storageServiceClient: { databases: transport },
}));

function detail(sqlName = 'guests', readSqlName?: string): DatabaseDetail {
  return {
    database: {
      id: 'db',
      name: 'Personal',
      owner_id: 'owner',
      created_at: '',
      trashed_at: null,
    },
    grant: 'owner',
    tables: [
      {
        table: {
          id: 'guests-table',
          database_id: 'db',
          name: 'Guests',
          position: 'a',
          version: 5,
        },
        sql_name: sqlName,
        read_sql_name: readSqlName,
        columns: [
          {
            column: {
              id: 'name',
              table_id: 'guests-table',
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
          },
        ],
      },
    ],
  };
}

const read: ExecOutcome = {
  results: [
    {
      columns: [
        { name: 'row_id', entity_type: null, origin: null },
        { name: 'Name', entity_type: null, origin: null },
      ],
      rows: [['record', 'Ada']],
    },
  ],
  changes_applied: 0,
  inserted_row_ids: [],
  new_versions: {},
  read_tables: ['guests-table'],
  read_versions: { 'guests-table': 5 },
  truncated_tables: [],
};
const written: ExecOutcome = {
  ...read,
  results: [],
  changes_applied: 1,
  new_versions: { 'guests-table': 6 },
};
const edit: DatabaseRowMutation = {
  kind: 'cell',
  rowId: 'record',
  columnId: 'name',
  value: 'Grace',
};
const clients: QueryClient[] = [];

function setup(
  initialDetail: DatabaseDetail,
  exec: (request: ExecRequest) => Promise<ExecOutcome>,
  options: {
    addOption?: DatabaseRowsSource['addOption'];
    onSource?: (source: DatabaseRowsSource) => void;
  } = {}
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  client.setQueryData(databasesKeys.detail('db').queryKey, initialDetail);
  const applyVersions = vi.fn();
  let source!: DatabaseRowsSource;
  function Harness() {
    source = createDatabaseRowsSource({
      databaseId: 'db',
      // Deliberately retain old props: retries must use the refreshed cache.
      table: () => initialDetail.tables[0],
      exec,
      applyVersions,
      addOption: options.addOption ?? (async () => {}),
    });
    options.onSource?.(source);
    return null;
  }
  const { unmount } = render(() => (
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>
  ));
  return { source, client, applyVersions, unmount };
}

afterEach(() => {
  cleanup();
  for (const client of clients) client.clear();
  clients.length = 0;
  vi.resetAllMocks();
});

describe('database rows SQL names', () => {
  it('distinguishes an uncertain INSERT response from a definitive SQL refusal', async () => {
    const exec = vi
      .fn<(request: ExecRequest) => Promise<ExecOutcome>>()
      .mockResolvedValue(read);
    const { source } = setup(detail(), exec);
    await waitFor(() => expect(source.loading()).toBe(false));
    exec.mockRejectedValueOnce(
      Object.assign(new Error('Connection closed'), { code: 'HTTP_ERROR' })
    );
    await expect(
      source.write({ kind: 'create', values: { name: 'Ada' } }, 5)
    ).rejects.toBeInstanceOf(DatabaseWriteOutcomeUnknown);

    const refused = Object.assign(new Error('Invalid value'), {
      code: 'SQL_ERROR',
    });
    transport.get.mockResolvedValue(ok(detail()));
    exec.mockRejectedValueOnce(refused);
    await expect(
      source.write({ kind: 'create', values: { name: 'Ada' } }, 5)
    ).rejects.toBe(refused);
  });

  it.each([
    ['stable read alias', 'stable_guests_uuid', 'stable_guests_uuid'],
    ['older server physical name', undefined, 'guests'],
  ])('reads through the %s', async (_label, alias, expected) => {
    const exec = vi.fn<(request: ExecRequest) => Promise<ExecOutcome>>(
      async () => read
    );
    const { source } = setup(detail('guests', alias), exec);
    await waitFor(() =>
      expect(source.snapshot()?.rows).toEqual([
        { rowId: 'record', cells: { name: 'Ada' } },
      ])
    );
    expect(exec).toHaveBeenCalledWith({ sql: `SELECT * FROM "${expected}"` });
  });

  it('refreshes only this database after SQL_ERROR and rebuilds the physical write name on explicit retry', async () => {
    const exec = vi
      .fn<(request: ExecRequest) => Promise<ExecOutcome>>()
      .mockResolvedValue(read);
    const { source, client, applyVersions } = setup(
      detail('guests', 'stable_guests_uuid'),
      exec
    );
    await waitFor(() => expect(source.loading()).toBe(false));
    const collision = Object.assign(new Error('no such table: guests'), {
      code: 'SQL_ERROR',
    });
    const refreshed = detail('Personal.Guests', 'stable_guests_uuid');
    transport.get.mockResolvedValue(ok(refreshed));
    exec.mockRejectedValueOnce(collision).mockResolvedValueOnce(written);

    await expect(source.write(edit, 5)).rejects.toBe(collision);
    expect(transport.get).toHaveBeenCalledExactlyOnceWith({ id: 'db' });
    expect(exec).toHaveBeenCalledTimes(2);
    expect(applyVersions).not.toHaveBeenCalled();
    expect(client.getQueryData(databasesKeys.detail('db').queryKey)).toEqual(
      refreshed
    );

    await expect(source.write(edit, 5)).resolves.toEqual({
      insertedRowIds: [],
      version: 6,
    });
    expect(exec).toHaveBeenLastCalledWith({
      sql: 'UPDATE "Personal.Guests" SET "Name" = \'Grace\' WHERE "row_id" = \'record\'',
      baseVersions: { 'guests-table': 5 },
    });
    expect(transport.get).toHaveBeenCalledTimes(1);
    expect(applyVersions).toHaveBeenCalledExactlyOnceWith({
      'guests-table': 6,
    });
  });

  it('retains the original error and blocks stale writes until schema recovery succeeds', async () => {
    const exec = vi
      .fn<(request: ExecRequest) => Promise<ExecOutcome>>()
      .mockResolvedValue(read);
    const { source } = setup(detail(), exec);
    await waitFor(() => expect(source.loading()).toBe(false));
    const collision = Object.assign(new Error('no such table: guests'), {
      code: 'SQL_ERROR',
    });
    transport.get.mockResolvedValue(
      err([{ code: 'HTTP_ERROR', message: 'Connection lost' }])
    );
    exec.mockRejectedValueOnce(collision).mockResolvedValueOnce(written);

    await expect(source.write(edit, 5)).rejects.toBe(collision);
    await expect(source.write(edit, 5)).rejects.toBe(collision);
    expect(transport.get).toHaveBeenCalledTimes(2);
    expect(exec).toHaveBeenCalledTimes(2);

    transport.get.mockResolvedValue(
      ok(detail('Personal.Guests', 'stable_guests_uuid'))
    );
    await expect(source.write(edit, 5)).resolves.toEqual({
      insertedRowIds: [],
      version: 6,
    });
    expect(transport.get).toHaveBeenCalledTimes(3);
    expect(exec).toHaveBeenCalledTimes(3);
    expect(exec).toHaveBeenLastCalledWith({
      sql: 'UPDATE "Personal.Guests" SET "Name" = \'Grace\' WHERE "row_id" = \'record\'',
      baseVersions: { 'guests-table': 5 },
    });
  });

  it('recovers a failed legacy read through the refreshed stable alias', async () => {
    const collision = Object.assign(new Error('no such table: guests'), {
      code: 'SQL_ERROR',
    });
    const exec = vi
      .fn<(request: ExecRequest) => Promise<ExecOutcome>>()
      .mockRejectedValueOnce(collision)
      .mockResolvedValue(read);
    const { source } = setup(detail(), exec);
    await waitFor(() => expect(source.error()).toBe(collision));
    transport.get.mockResolvedValue(
      ok(detail('Personal.Guests', 'stable_guests_uuid'))
    );

    await source.refresh();
    await waitFor(() => expect(source.error()).toBeUndefined());
    expect(transport.get).toHaveBeenCalledExactlyOnceWith({ id: 'db' });
    expect(exec).toHaveBeenNthCalledWith(1, { sql: 'SELECT * FROM "guests"' });
    expect(exec).toHaveBeenNthCalledWith(2, {
      sql: 'SELECT * FROM "stable_guests_uuid"',
    });
    expect(source.snapshot()?.rows).toEqual([
      { rowId: 'record', cells: { name: 'Ada' } },
    ]);
  });
});

describe('accepted writes after switching tables', () => {
  it('reads the option schema version after disposal before finishing an accepted draft field', async () => {
    const initial = detail();
    const status = structuredClone(initial.tables[0].columns[0]);
    status.column.id = 'status';
    status.column.property_definition_id = 'status-definition';
    status.sql_name = 'Status';
    status.definition.definition.id = 'status-definition';
    status.definition.definition.display_name = 'Status';
    initial.tables[0].columns.push(status);

    let version = 5;
    let persistedRows: (string | null)[][] = [];
    let releaseCreate!: () => void;
    const createReady = new Promise<void>((resolve) => {
      releaseCreate = resolve;
    });
    const writes: ExecRequest[] = [];
    const exec = vi.fn(async (request: ExecRequest): Promise<ExecOutcome> => {
      if (request.sql.startsWith('SELECT')) {
        return {
          ...read,
          results: [
            {
              columns: [
                ...read.results[0].columns,
                { name: 'Status', entity_type: null, origin: null },
              ],
              rows: structuredClone(persistedRows),
            },
          ],
          read_versions: { 'guests-table': version },
        };
      }
      writes.push(request);
      const creating = request.sql.startsWith('INSERT');
      if (creating) await createReady;
      if (request.baseVersions?.['guests-table'] !== version)
        throw Object.assign(new Error('Stale table version'), {
          code: 'VERSION_CONFLICT',
        });
      if (creating)
        persistedRows = [['server-record', 'Accepted record', null]];
      else persistedRows[0][2] = 'In review';
      version += 1;
      return {
        ...written,
        inserted_row_ids: creating ? ['server-record'] : [],
        new_versions: { 'guests-table': version },
      };
    });
    const addOption = vi.fn(async () => {
      // Real option creation changes the schema and advances the table's CAS.
      version += 1;
    });
    let drafts!: ReturnType<typeof createDraftRows>;
    let controller!: ReturnType<typeof createTableController>;
    const { source, unmount } = setup(initial, exec, {
      addOption,
      onSource(source) {
        controller = createTableController(source);
        drafts = createDraftRows(controller);
      },
    });
    await waitFor(() => expect(source.snapshot()?.version).toBe(5));
    const draftId = drafts.blankId();
    const name = drafts.write(draftId, 'name', 'Accepted record');
    await waitFor(() => expect(writes).toHaveLength(1));
    const statusWrite = drafts.write(
      draftId,
      'status',
      'In review',
      'In review'
    );
    unmount();
    releaseCreate();

    expect(await Promise.all([name, statusWrite])).toEqual([true, true]);
    expect(addOption).toHaveBeenCalledExactlyOnceWith('status', 'In review');
    expect(writes).toEqual([
      {
        sql: 'INSERT INTO "guests" ("Name") VALUES (\'Accepted record\')',
        baseVersions: { 'guests-table': 5 },
      },
      {
        sql: 'UPDATE "guests" SET "Status" = \'In review\' WHERE "row_id" = \'server-record\'',
        baseVersions: { 'guests-table': 7 },
      },
    ]);
    expect(source.snapshot()).toEqual({
      version: 8,
      rows: [
        {
          rowId: 'server-record',
          cells: { name: 'Accepted record', status: 'In review' },
        },
      ],
    });
    expect(controller.failure()).toBeUndefined();
  });

  it('keeps the last actual read when a refresh fails after disposal', async () => {
    const exec = vi
      .fn<(request: ExecRequest) => Promise<ExecOutcome>>()
      .mockResolvedValue(read);
    const { source, client, unmount } = setup(detail(), exec);
    await waitFor(() => expect(source.snapshot()?.version).toBe(5));
    unmount();
    const refreshed = { ...read, read_versions: { 'guests-table': 6 } };
    exec.mockResolvedValueOnce(refreshed);
    await source.refresh();
    expect(source.snapshot()?.version).toBe(6);

    const newerSchema = detail();
    newerSchema.tables[0].table.version = 10;
    client.setQueryData(databasesKeys.detail('db').queryKey, newerSchema);
    exec.mockRejectedValueOnce(new Error('Offline'));
    await expect(source.refresh()).rejects.toThrow('Offline');
    expect(source.snapshot()?.version).toBe(6);
    expect(source.snapshot()?.rows).toEqual([
      { rowId: 'record', cells: { name: 'Ada' } },
    ]);
  });
});

describe('first-entry column types', () => {
  function inferredDetail(
    dataType: 'STRING' | 'NUMBER' | 'ENTITY',
    entityType?: 'USER' | 'DOCUMENT'
  ) {
    const value = detail();
    const column = value.tables[0].columns[0];
    column.column.infer_type = false;
    column.definition.definition.data_type = dataType;
    column.definition.definition.specific_entity_type = entityType ?? null;
    return column;
  }

  it.each([
    ['12.5', 'NUMBER', '12.5'],
    ['00123', 'STRING', "'00123'"],
    ['hello', 'STRING', "'hello'"],
  ] as const)(
    'settles the first %s entry and writes with the acknowledged schema version',
    async (value, type, sqlValue) => {
      const initial = detail();
      initial.tables[0].columns[0].column.infer_type = true;
      const exec = vi.fn<(request: ExecRequest) => Promise<ExecOutcome>>(
        async () => read
      );
      const { source, client } = setup(initial, exec);
      await waitFor(() => expect(source.loading()).toBe(false));
      transport.inferColumnType.mockResolvedValue(
        ok({ column: inferredDetail(type), table_version: 6 })
      );
      exec.mockResolvedValue({
        ...written,
        new_versions: { 'guests-table': 7 },
      });
      await source.write({ kind: 'create', values: { name: value } }, 5);
      expect(transport.inferColumnType).toHaveBeenCalledExactlyOnceWith({
        id: 'db',
        tableId: 'guests-table',
        columnId: 'name',
        request: { data_type: type, base_version: 5 },
      });
      expect(exec).toHaveBeenLastCalledWith({
        sql: `INSERT INTO "guests" ("Name") VALUES (${sqlValue})`,
        baseVersions: { 'guests-table': 6 },
      });
      expect(
        client.getQueryData<DatabaseDetail>(databasesKeys.detail('db').queryKey)
          ?.tables[0].columns[0].column.infer_type
      ).toBe(false);
    }
  );

  it('uses the selected mention type and retains its entity ID', async () => {
    const initial = detail();
    initial.tables[0].columns[0].column.infer_type = true;
    const exec = vi.fn<(request: ExecRequest) => Promise<ExecOutcome>>(
      async () => read
    );
    const { source } = setup(initial, exec);
    await waitFor(() => expect(source.loading()).toBe(false));
    transport.inferColumnType.mockResolvedValue(
      ok({ column: inferredDetail('ENTITY', 'USER'), table_version: 6 })
    );
    await source.write(
      {
        kind: 'cell',
        rowId: 'record',
        columnId: 'name',
        value: 'macro|ada@example.com',
        columnTypes: { name: { dataType: 'ENTITY', entityType: 'USER' } },
      },
      5
    );
    expect(transport.inferColumnType.mock.calls[0][0].request).toEqual({
      data_type: 'ENTITY',
      specific_entity_type: 'USER',
      base_version: 5,
    });
    expect(exec).toHaveBeenLastCalledWith({
      sql: 'UPDATE "guests" SET "Name" = \'macro|ada@example.com\' WHERE "row_id" = \'record\'',
      baseVersions: { 'guests-table': 6 },
    });
  });

  it('never infers a manually chosen text column or an empty value', async () => {
    const exec = vi.fn<(request: ExecRequest) => Promise<ExecOutcome>>(
      async () => read
    );
    const { source } = setup(detail(), exec);
    await waitFor(() => expect(source.loading()).toBe(false));
    await source.write({ ...edit, value: '123' }, 5);
    expect(transport.inferColumnType).not.toHaveBeenCalled();
    expect(exec.mock.calls.at(-1)?.[0].sql).toContain("= '123'");
  });

  it('refreshes after a competing first-entry type decision and does not submit stale SQL', async () => {
    const initial = detail();
    initial.tables[0].columns[0].column.infer_type = true;
    const exec = vi.fn<(request: ExecRequest) => Promise<ExecOutcome>>(
      async () => read
    );
    const { source } = setup(initial, exec);
    await waitFor(() => expect(source.loading()).toBe(false));
    transport.inferColumnType.mockResolvedValue(
      err([{ code: 'VERSION_CONFLICT', message: 'Column changed' }])
    );
    transport.get.mockResolvedValue(ok(detail()));
    await expect(source.write({ ...edit, value: '123' }, 5)).rejects.toThrow(
      'Column changed'
    );
    expect(exec).toHaveBeenCalledTimes(1);
    expect(transport.get).toHaveBeenCalledOnce();
  });

  it('retries a failed value write using its own completed type change without inferring again', async () => {
    const initial = detail();
    initial.tables[0].columns[0].column.infer_type = true;
    const exec = vi.fn<(request: ExecRequest) => Promise<ExecOutcome>>(
      async () => read
    );
    const { source } = setup(initial, exec);
    await waitFor(() => expect(source.loading()).toBe(false));
    transport.inferColumnType.mockResolvedValue(
      ok({ column: inferredDetail('NUMBER'), table_version: 6 })
    );
    exec.mockRejectedValueOnce(new Error('Offline'));
    const mutation: DatabaseRowMutation = { ...edit, value: '12' };
    await expect(source.write(mutation, 5)).rejects.toThrow('Offline');
    await source.write(mutation, 5);
    expect(transport.inferColumnType).toHaveBeenCalledOnce();
    expect(exec).toHaveBeenLastCalledWith({
      sql: 'UPDATE "guests" SET "Name" = 12 WHERE "row_id" = \'record\'',
      baseVersions: { 'guests-table': 6 },
    });
  });
});
