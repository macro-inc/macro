import type { CacheRevision } from '@app/lib/graphql-cache/protocol';
import type {
  CellValue,
  DatabaseOp,
  Outcome,
  Step,
  ViewQuery,
} from '@core/database-sql/generated/types';
import type { CacheHost } from '@graphql-cache/host/types';
import { queryClient } from '@queries/client';
import type { DatabaseSqlQueryCapabilities } from '@queries/database-sql/create-database-sql-query';
import {
  applyDatabaseOps,
  applyDatabaseTableVersions,
  onDatabaseBatchCommitted,
  onDatabaseTableAdvanced,
  undoDatabaseChange,
} from '@queries/storage/databases';
import { databasesKeys } from '@queries/storage/keys';
import type { DatabaseOpsError } from '@service-storage/databases';
import type { DatabaseDetail } from '@service-storage/generated/schemas/databaseDetail';
import type { DatabaseView } from '@service-storage/generated/schemas/databaseView';
import type { OpResult } from '@service-storage/generated/schemas/opResult';
import type { SoupQuery } from '@service-storage/graphql/generated/graphql';
import { cleanup, render, waitFor } from '@solidjs/testing-library';
import { QueryClientProvider } from '@tanstack/solid-query';
import { CombinedError, createClient, type Exchange } from '@urql/core';
import { err, errAsync, ok, okAsync, ResultAsync } from 'neverthrow';
import { type Accessor, createSignal, onCleanup } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { empty, fromValue, mergeMap, pipe } from 'wonka';
import type { DatabaseRowsSource } from '../../database/context/table-source';
import type { DatabaseRowMutation } from '../../database/core/table';
import { allRecordsView } from '../../database/core/views';
import { createDraftRows } from '../../database/primitives/draft-rows';
import { createTableController } from '../../database/primitives/table-controller';
import { createDatabaseColumn } from './columns';

function renameDatabaseColumn(params: {
  databaseId: string;
  tableId: string;
  columnId: string;
  name: string;
  previousName: string;
}) {
  return applyDatabaseOps(params.databaseId, [
    {
      kind: 'column',
      table: params.tableId,
      column: params.columnId,
      change: {
        kind: 'rename',
        name: params.name,
        previousName: params.previousName,
      },
    },
  ]).map(() => undefined);
}

import { createDatabaseRowsSource } from './table-rows';

const transport = vi.hoisted(() => ({
  applyOps: vi.fn(),
  get: vi.fn(),
  inferColumnType: vi.fn(),
  undoChange: vi.fn(),
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

function detail(sqlName = '"guests"'): DatabaseDetail {
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
        views: [],
        table: {
          id: 'guests-table',
          database_id: 'db',
          name: 'Guests',
          position: 'a',
          version: 5,
        },
        sql_name: sqlName,
        columns: [
          {
            shared_outside_database: false,
            column: {
              id: 'name',
              table_id: 'guests-table',
              property_definition_id: 'definition',
              position: 'a',
              config: null,
              display_name: null,
              infer_type: false,
            },
            sql_name: '"Name"',
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

/** The engine's answer for `SELECT * FROM "guests"` over one row. */
function guests(
  rows: { id: string; name: string | null }[] = [{ id: 'record', name: 'Ada' }]
): Outcome {
  return {
    columns: [{ name: 'Name', column: 'definition', kind: 'text' }],
    rows: rows.map((row) => [
      row.name === null ? null : { type: 'text', value: row.name },
    ]),
    rowIds: rows.map((row) => row.id),
    readTables: ['guests-table'],
    truncated: false,
    insertedRowIds: [],
    changesApplied: 0,
  };
}
const rowsWritten: Extract<OpResult, { kind: 'rows' }> = {
  kind: 'rows',
  table: 'guests-table',
  tableVersion: 6,
  change: { kind: 'updated', affected: 1 },
};
const written: OpResult[] = [rowsWritten];
/** The one op that sets `record`'s Name cell. */
function nameEdit(value: CellValue): DatabaseOp[] {
  return [
    {
      kind: 'rows',
      table: 'guests-table',
      change: {
        kind: 'update',
        changes: {
          kind: 'per_row',
          rows: [{ row: 'record', cells: [{ column: 'name', value }] }],
        },
      },
    },
  ];
}
/** The one op that inserts a row with this Name. */
function nameInsert(value: CellValue): DatabaseOp[] {
  return [
    {
      kind: 'rows',
      table: 'guests-table',
      change: { kind: 'insert', rows: [[{ column: 'name', value }]] },
    },
  ];
}
type ApplyOps = (
  ops: DatabaseOp[]
) => ResultAsync<OpResult[], DatabaseOpsError>;
const edit: DatabaseRowMutation = {
  kind: 'cell',
  rowId: 'record',
  columnId: 'name',
  value: 'Grace',
};

const allGuests = allRecordsView({ id: 'guests-table', database_id: 'db' });

/**
 * The browser engine, answering each statement or view it compiles from
 * `answer` after one Soup page: a statement as its SQL, a view as its query.
 * Soup fails while `offline` says so; `answer` throws a string the way the
 * engine refuses a statement.
 */
function engine(
  answer: (read: string | ViewQuery) => Outcome | Promise<Outcome> = () =>
    guests(),
  offline: () => boolean = () => false
) {
  const reads: (string | ViewQuery)[] = [];
  const query = (outcome: Outcome) => ({
    start: () => fetch,
    feed_page: () => ({ step: 'done' as const, ...outcome }),
    feed_bins: () => {
      throw 'no bins';
    },
    free: () => {},
  });
  const exchange: Exchange = () => (incoming) =>
    pipe(
      incoming,
      mergeMap((operation) => {
        if (operation.kind === 'teardown') return empty;
        if (offline())
          return fromValue({
            operation,
            error: new CombinedError({ networkError: new Error('Offline') }),
            stale: false,
            hasNext: false,
          });
        const data: SoupQuery = {
          user: {
            id: 'macro|viewer@databases.test',
            emailLinks: [],
            soup: { items: [], nextCursor: null },
          },
        };
        return fromValue({ operation, data, stale: false, hasNext: false });
      })
    );
  const client = createClient({
    url: 'http://test.invalid/graphql',
    exchanges: [exchange],
  });
  const fetch: Step = {
    step: 'fetch',
    id: 0,
    query: { type: 'soup', table: 'guests-table', propf: null, keyHint: null },
    needs: ['definition'],
    cursor: null,
    limit: 500,
  };
  const read: DatabaseSqlQueryCapabilities = {
    client: () => client,
    cacheHost: () => undefined,
    people: async () => [],
    catalog: async () => ({
      tables: [
        {
          id: 'guests-table',
          databaseId: 'db',
          database: 'Personal',
          name: 'Guests',
          source: 'database',
          columns: [
            {
              id: 'definition',
              placement: 'name',
              name: 'Name',
              kind: { kind: 'text' },
            },
            {
              id: 'status-definition',
              placement: 'status',
              name: 'Status',
              kind: { kind: 'text' },
            },
          ],
        },
      ],
    }),
    open: async (_catalog, sql) => {
      reads.push(sql);
      return query(await answer(sql));
    },
    openView: async (_catalog, view) => {
      reads.push(view.query);
      return query(await answer(view.query));
    },
  };
  return { read, reads };
}

function setup(
  initialDetail: DatabaseDetail,
  applyOps: ApplyOps,
  options: {
    read?: DatabaseSqlQueryCapabilities;
    addOption?: DatabaseRowsSource['addOption'];
    onSource?: (source: DatabaseRowsSource) => void;
    view?: Accessor<DatabaseView>;
    onTableChanged?: (listener: (version: number) => void) => void;
    changes?: Parameters<typeof createDatabaseRowsSource>[0]['changes'];
  } = {}
) {
  const client = queryClient;
  client.setQueryData(databasesKeys.detail('db').queryKey, initialDetail);
  // As in the app, a write's versions land in the cached schema.
  const applyVersions = vi.fn((versions: Record<string, number>) =>
    applyDatabaseTableVersions('db', versions)
  );
  let tableChanged: (version: number) => void = () => {};
  let source!: DatabaseRowsSource;
  function Harness() {
    source = createDatabaseRowsSource({
      databaseId: 'db',
      // Deliberately retain old props: retries must use the refreshed cache.
      table: () => initialDetail.tables[0],
      view: options.view ?? (() => allGuests),
      applyOps,
      read: options.read ?? engine().read,
      changes: options.changes,
      onTableChanged:
        options.onTableChanged ??
        ((listener) => {
          tableChanged = listener;
        }),
      // As in the app, this viewer's own batches report their versions.
      onCommitted: (listener) => {
        onCleanup(
          onDatabaseBatchCommitted((batch) => {
            const version = batch.tableVersions['guests-table'];
            if (batch.databaseId === 'db' && version !== undefined)
              listener(version);
          })
        );
      },
      applyVersions,
      addOption: options.addOption ?? (() => okAsync(undefined)),
    });
    options.onSource?.(source);
    return null;
  }
  const { unmount } = render(() => (
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>
  ));
  return {
    source,
    client,
    applyVersions,
    unmount,
    tableChanged: (version: number) => tableChanged(version),
  };
}

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.resetAllMocks();
});

describe('database view reads', () => {
  it('runs the view in the engine and keeps the previous rows while a changed one loads', async () => {
    const [view, setView] = createSignal(allGuests);
    let finishSearch!: (outcome: Outcome) => void;
    const { read, reads } = engine((request) =>
      typeof request !== 'string' && request.filter
        ? new Promise((resolve) => {
            finishSearch = resolve;
          })
        : guests()
    );
    const applyOps = vi.fn<ApplyOps>();
    const { source } = setup(detail(), applyOps, { read, view });
    await waitFor(() =>
      expect(source.snapshot()?.rows).toEqual([
        { rowId: 'record', cells: { name: 'Ada' } },
      ])
    );

    setView({
      ...allGuests,
      query: {
        filter: {
          conjunction: 'and',
          conditions: [
            {
              kind: 'condition',
              column: 'name',
              test: { kind: 'text', operator: 'contains', value: 'grace' },
            },
          ],
        },
        sort: [],
      },
    });
    await waitFor(() =>
      expect(reads.at(-1)).toEqual({
        filter: {
          conjunction: 'and',
          conditions: [
            {
              kind: 'condition',
              column: 'name',
              test: { kind: 'text', operator: 'contains', value: 'grace' },
            },
          ],
        },
        sort: [],
      })
    );
    expect(source.loading()).toBe(false);
    expect(source.refreshing()).toBe(true);
    expect(source.snapshot()?.rows).toEqual([
      { rowId: 'record', cells: { name: 'Ada' } },
    ]);

    finishSearch(guests([{ id: 'other', name: 'Grace' }]));
    await waitFor(() =>
      expect(source.snapshot()?.rows).toEqual([
        { rowId: 'other', cells: { name: 'Grace' } },
      ])
    );
    expect(reads[0]).toEqual({ filter: null, sort: [] });
    expect(applyOps).not.toHaveBeenCalled();
  });

  it('reads the rows the view retains by id, apart from its statement', async () => {
    const { read, reads } = engine((request) =>
      typeof request === 'string' && request.includes('row_id IN')
        ? guests([{ id: 'kept', name: 'Hidden' }])
        : guests()
    );
    const { source } = setup(detail(), vi.fn(), {
      read,
      view: () => ({
        ...allGuests,
        query: {
          filter: {
            conjunction: 'and',
            conditions: [
              {
                kind: 'condition',
                column: 'name',
                test: { kind: 'text', operator: 'is', value: 'Ada' },
              },
            ],
          },
          sort: [],
        },
      }),
    });
    const [retained, setRetained] = createSignal<string[]>([]);
    source.retain(retained);
    await waitFor(() => expect(source.snapshot()?.retained).toEqual([]));
    expect(reads).toEqual([
      {
        filter: {
          conjunction: 'and',
          conditions: [
            {
              kind: 'condition',
              column: 'name',
              test: { kind: 'text', operator: 'is', value: 'Ada' },
            },
          ],
        },
        sort: [],
      },
    ]);

    setRetained(['kept']);
    await waitFor(() =>
      expect(source.snapshot()?.retained).toEqual([
        { rowId: 'kept', cells: { name: 'Hidden' } },
      ])
    );
    expect(reads.at(-1)).toBe(
      'SELECT * FROM "guests" WHERE row_id IN (\'kept\')'
    );
    expect(source.snapshot()?.rows).toEqual([
      { rowId: 'record', cells: { name: 'Ada' } },
    ]);
  });

  it("reads again when another viewer changes the table, but not for this writer's own change", async () => {
    let name = 'Ada';
    const { read, reads } = engine(() => guests([{ id: 'record', name }]));
    const applyOps = vi.fn<ApplyOps>(() => okAsync(written));
    const { source, tableChanged } = setup(detail(), applyOps, { read });
    await waitFor(() => expect(source.snapshot()?.version).toBe(5));

    await source.write(edit, 5, false);
    await source.refresh();
    expect(source.snapshot()?.version).toBe(6);
    const afterOwnWrite = reads.length;
    tableChanged(6);
    expect(reads).toHaveLength(afterOwnWrite);

    name = 'Grace';
    tableChanged(7);
    await waitFor(() =>
      expect(source.snapshot()).toEqual({
        version: 7,
        rows: [{ rowId: 'record', cells: { name: 'Grace' } }],
        retained: [],
      })
    );
    expect(reads).toHaveLength(afterOwnWrite + 1);
  });

  it('creates a label the column lacks with add_options ahead of the write, in one batch', async () => {
    const schema = detail();
    const definition = schema.tables[0].columns[0].definition;
    definition.definition.data_type = 'SELECT_STRING';
    definition.property_options = [
      {
        id: 'vip',
        property_definition_id: 'definition',
        display_order: 0,
        value: { type: 'string', value: 'VIP' },
        color: '#889096',
        created_at: '',
        updated_at: '',
      },
    ];
    const applyOps = vi.fn<ApplyOps>(() =>
      okAsync([
        {
          kind: 'column',
          table: 'guests-table',
          column: 'name',
          tableVersion: 6,
          change: { kind: 'options_added', added: ['new-option'] },
        },
        rowsWritten,
      ])
    );
    const { source } = setup(schema, applyOps);
    await waitFor(() => expect(source.snapshot()?.version).toBe(5));

    const result = await source.write(
      { kind: 'cell', rowId: 'record', columnId: 'name', value: 'Plus one' },
      5,
      true
    );

    expect(result.isOk()).toBe(true);
    expect(applyOps).toHaveBeenCalledExactlyOnceWith([
      {
        kind: 'column',
        table: 'guests-table',
        column: 'name',
        change: {
          kind: 'add_options',
          options: [{ id: expect.any(String), label: 'Plus one' }],
        },
      },
      {
        kind: 'rows',
        table: 'guests-table',
        change: {
          kind: 'update',
          changes: {
            kind: 'per_row',
            rows: [
              {
                row: 'record',
                cells: [
                  {
                    column: 'name',
                    value: { type: 'options', value: [{ label: 'Plus one' }] },
                  },
                ],
              },
            ],
          },
        },
      },
    ]);
  });

  it("does not read again when this writer's own change is announced before its read-back lands", async () => {
    const { read, reads } = engine(() =>
      guests([{ id: 'record', name: 'Ada' }])
    );
    const applyOps = vi.fn<ApplyOps>(() => okAsync(written));
    const { source, tableChanged } = setup(detail(), applyOps, { read });
    await waitFor(() => expect(source.snapshot()?.version).toBe(5));
    const beforeWrite = reads.length;

    await source.write(edit, 5, false);
    // The gateway announces version 6, the write's own, before the writer reads it back.
    tableChanged(6);
    await source.refresh();

    expect(source.snapshot()?.version).toBe(6);
    expect(reads).toHaveLength(beforeWrite + 1);
  });

  it('shows a failed read as the grid error and keeps the rows it had', async () => {
    let offline = false;
    const { read } = engine(
      () => guests(),
      () => offline
    );
    const { source, tableChanged } = setup(detail(), vi.fn(), { read });
    await waitFor(() => expect(source.snapshot()?.rows).toHaveLength(1));

    offline = true;
    tableChanged(9);
    await waitFor(() =>
      expect(source.error()).toEqual({
        kind: 'fetch',
        message: expect.stringContaining('Offline'),
      })
    );
    expect(source.snapshot()).toEqual({
      version: 5,
      rows: [{ rowId: 'record', cells: { name: 'Ada' } }],
      retained: [],
    });
  });
});

describe('a column type change', () => {
  it('keeps the column’s last type and cells until the read of its new type lands', async () => {
    const before = detail();
    const [nameColumn] = before.tables[0].columns;
    const after: DatabaseDetail = {
      ...before,
      tables: [
        {
          ...before.tables[0],
          table: { ...before.tables[0].table, version: 6 },
          columns: [
            {
              ...nameColumn,
              column: {
                ...nameColumn.column,
                property_definition_id: 'number-definition',
              },
              definition: {
                ...nameColumn.definition,
                definition: {
                  ...nameColumn.definition.definition,
                  id: 'number-definition',
                  data_type: 'NUMBER',
                },
              },
            },
          ],
        },
      ],
    };
    let finishNumbers!: (outcome: Outcome) => void;
    const numbers = new Promise<Outcome>((resolve) => {
      finishNumbers = resolve;
    });
    const fetch: Step = {
      step: 'fetch',
      id: 0,
      query: {
        type: 'soup',
        table: 'guests-table',
        propf: null,
        keyHint: null,
      },
      needs: [],
      cursor: null,
      limit: 500,
    };
    const answering = (outcome: Outcome) => ({
      start: () => fetch,
      feed_page: () => ({ step: 'done' as const, ...outcome }),
      feed_bins: () => {
        throw 'no bins';
      },
      free: () => {},
    });
    const client = createClient({
      url: 'http://test.invalid/graphql',
      exchanges: [
        () => (incoming) =>
          pipe(
            incoming,
            mergeMap((operation) => {
              if (operation.kind === 'teardown') return empty;
              const data: SoupQuery = {
                user: {
                  id: 'macro|viewer@databases.test',
                  emailLinks: [],
                  soup: { items: [], nextCursor: null },
                },
              };
              return fromValue({
                operation,
                data,
                stale: false,
                hasNext: false,
              });
            })
          ),
      ],
    });
    const [table, setTable] = createSignal(before.tables[0]);
    queryClient.setQueryData(databasesKeys.detail('db').queryKey, before);
    let source!: DatabaseRowsSource;
    function Harness() {
      source = createDatabaseRowsSource({
        databaseId: 'db',
        table,
        view: () => allGuests,
        applyOps: vi.fn<ApplyOps>(),
        read: {
          client: () => client,
          cacheHost: () => undefined,
          people: async () => [],
          catalog: async (schema) => ({
            tables: [
              {
                id: 'guests-table',
                databaseId: 'db',
                database: 'Personal',
                name: 'Guests',
                source: 'database',
                columns: schema.databases[0].tables[0].columns.map(
                  (column) => ({
                    id: column.definition,
                    placement: column.id,
                    name: column.name,
                    kind:
                      column.definition === 'number-definition'
                        ? { kind: 'number' }
                        : { kind: 'text' },
                  })
                ),
              },
            ],
          }),
          openView: async (catalog) =>
            answering(
              catalog.tables[0].columns[0].id === 'number-definition'
                ? await numbers
                : guests()
            ),
        },
        onTableChanged: () => {},
        onCommitted: () => {},
        applyVersions: () => {},
        addOption: () => okAsync(undefined),
      });
      return null;
    }
    render(() => (
      <QueryClientProvider client={queryClient}>
        <Harness />
      </QueryClientProvider>
    ));
    await waitFor(() =>
      expect(source.snapshot()?.rows).toEqual([
        { rowId: 'record', cells: { name: 'Ada' } },
      ])
    );

    queryClient.setQueryData(databasesKeys.detail('db').queryKey, after);
    setTable(after.tables[0]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(source.columns()[0].dataType).toBe('STRING');
    expect(source.snapshot()?.rows).toEqual([
      { rowId: 'record', cells: { name: 'Ada' } },
    ]);

    finishNumbers({
      columns: [{ name: 'Name', column: 'number-definition', kind: 'number' }],
      rows: [[{ type: 'number', value: 7 }]],
      rowIds: ['record'],
      readTables: ['guests-table'],
      truncated: false,
      insertedRowIds: [],
      changesApplied: 0,
    });
    await waitFor(() =>
      expect(source.snapshot()?.rows).toEqual([
        { rowId: 'record', cells: { name: 7 } },
      ])
    );
    expect(source.columns()[0].dataType).toBe('NUMBER');
  });
});

describe('database rows SQL names', () => {
  it('replaces a relation cell with a list of row ids', async () => {
    const schema = detail();
    const column = schema.tables[0].columns[0];
    column.column.config = {
      kind: 'link',
      database_id: 'db',
      table_id: 'customers',
    };
    const applyOps = vi.fn<ApplyOps>(() => okAsync(written));
    const { source } = setup(schema, applyOps);
    await waitFor(() => expect(source.loading()).toBe(false));
    expect(source.columns()[0]).toMatchObject({
      writable: true,
      isMultiSelect: true,
      relation: { tableId: 'customers' },
    });
    applyOps.mockReturnValueOnce(okAsync(written));
    await source.write(
      {
        kind: 'cell',
        rowId: 'record',
        columnId: 'name',
        value: '["customer-1","customer-2"]',
      },
      5,
      false
    );
    expect(applyOps).toHaveBeenLastCalledWith([
      {
        kind: 'rows',
        table: 'guests-table',
        change: {
          kind: 'update',
          changes: {
            kind: 'per_row',
            rows: [
              {
                row: 'record',
                cells: [
                  {
                    column: 'name',
                    value: {
                      type: 'rows',
                      value: ['customer-1', 'customer-2'],
                    },
                  },
                ],
              },
            ],
          },
        },
      },
    ]);
  });

  it('creates a Customer-first row with its links in one insert without assigning its identity', async () => {
    const schema = detail();
    const column = schema.tables[0].columns[0];
    column.column.config = {
      kind: 'link',
      database_id: 'db',
      table_id: 'customers',
    };
    const applyOps = vi.fn<ApplyOps>(() => okAsync(written));
    const { source } = setup(schema, applyOps);
    await waitFor(() => expect(source.loading()).toBe(false));
    applyOps.mockClear();
    applyOps.mockReturnValueOnce(
      okAsync([
        {
          ...rowsWritten,
          change: { kind: 'inserted', rows: ['new-record'] },
        },
      ])
    );
    const result = await source.write(
      { kind: 'create', values: { name: '["customer-1"]' } },
      5,
      false
    );
    expect(applyOps).toHaveBeenCalledTimes(1);
    expect(applyOps).toHaveBeenCalledWith(
      nameInsert({ type: 'rows', value: ['customer-1'] })
    );
    expect(result).toEqual(ok({ insertedRowIds: ['new-record'], version: 6 }));
  });

  it('refuses relation writes when the column is read-only', async () => {
    const schema = detail();
    const column = schema.tables[0].columns[0];
    column.column.config = {
      kind: 'link',
      database_id: 'db',
      table_id: 'customers',
    };
    column.writable = false;
    const applyOps = vi.fn<ApplyOps>(() => okAsync(written));
    const { source } = setup(schema, applyOps);
    await waitFor(() => expect(source.loading()).toBe(false));
    applyOps.mockClear();
    expect(source.columns()[0].writable).toBe(false);
    expect(await source.write(edit, 5, false)).toEqual(
      err({ kind: 'read-only-column' })
    );
    expect(applyOps).not.toHaveBeenCalled();
  });

  it('distinguishes an uncertain insert response from a definitive refusal', async () => {
    const applyOps = vi.fn<ApplyOps>(() => okAsync(written));
    const { source } = setup(detail(), applyOps);
    await waitFor(() => expect(source.loading()).toBe(false));
    applyOps.mockReturnValueOnce(
      errAsync({
        code: 'HTTP_ERROR',
        message: 'Connection closed',
        refusal: null,
      })
    );
    expect(
      await source.write({ kind: 'create', values: { name: 'Ada' } }, 5, false)
    ).toEqual(err({ kind: 'outcome-unknown' }));

    const refused: DatabaseOpsError = {
      code: 'INVALID_OP',
      message: 'op 0: Invalid value',
      refusal: {
        message: 'op 0: Invalid value',
        op: 0,
        row: null,
        column: null,
        taken: null,
      },
    };
    transport.get.mockImplementation(() => okAsync(detail()));
    applyOps.mockReturnValueOnce(errAsync(refused));
    expect(
      await source.write({ kind: 'create', values: { name: 'Ada' } }, 5, false)
    ).toEqual(err({ kind: 'ops', error: refused }));
  });

  it('reads a table under any name through its view, matching result columns by definition', async () => {
    const { read, reads } = engine();
    const { source } = setup(detail('"Guest List"'), vi.fn(), { read });
    await waitFor(() =>
      expect(source.snapshot()?.rows).toEqual([
        { rowId: 'record', cells: { name: 'Ada' } },
      ])
    );
    expect(reads).toEqual([{ filter: null, sort: [] }]);
  });

  it('refreshes only this database after a refused op and writes against the refreshed schema on retry', async () => {
    const applyOps = vi.fn<ApplyOps>(() => okAsync(written));
    const { source, client, applyVersions } = setup(detail(), applyOps);
    await waitFor(() => expect(source.loading()).toBe(false));
    const collision: DatabaseOpsError = {
      code: 'INVALID_OP',
      message: 'op 0, row 0, column name: no such column in this table',
      refusal: {
        message: 'op 0, row 0, column name: no such column in this table',
        op: 0,
        row: 0,
        column: 'name',
        taken: null,
      },
    };
    const refreshed = detail('"Personal Guests"');
    transport.get.mockImplementation(() => okAsync(refreshed));
    applyOps
      .mockReturnValueOnce(errAsync(collision))
      .mockReturnValueOnce(okAsync(written));

    expect(await source.write(edit, 5, false)).toEqual(
      err({ kind: 'ops', error: collision })
    );
    expect(transport.get).toHaveBeenCalledExactlyOnceWith({ id: 'db' });
    expect(applyOps).toHaveBeenCalledTimes(1);
    expect(applyVersions).not.toHaveBeenCalled();
    expect(client.getQueryData(databasesKeys.detail('db').queryKey)).toEqual(
      refreshed
    );

    expect(await source.write(edit, 5, false)).toEqual(
      ok({ insertedRowIds: [], version: 6 })
    );
    expect(applyOps).toHaveBeenLastCalledWith(
      nameEdit({ type: 'text', value: 'Grace' })
    );
    expect(transport.get).toHaveBeenCalledTimes(1);
    expect(applyVersions).toHaveBeenCalledExactlyOnceWith({
      'guests-table': 6,
    });
  });

  it('retains the original error and blocks stale writes until schema recovery succeeds', async () => {
    const applyOps = vi.fn<ApplyOps>(() => okAsync(written));
    const { source } = setup(detail(), applyOps);
    await waitFor(() => expect(source.loading()).toBe(false));
    const collision: DatabaseOpsError = {
      code: 'INVALID_OP',
      message: 'op 0, row 0, column name: no such column in this table',
      refusal: {
        message: 'op 0, row 0, column name: no such column in this table',
        op: 0,
        row: 0,
        column: 'name',
        taken: null,
      },
    };
    transport.get.mockImplementation(() =>
      errAsync([{ code: 'HTTP_ERROR', message: 'Connection lost' }])
    );
    applyOps
      .mockReturnValueOnce(errAsync(collision))
      .mockReturnValueOnce(okAsync(written));

    expect(await source.write(edit, 5, false)).toEqual(
      err({ kind: 'ops', error: collision })
    );
    // The schema stays stale, so the next write is blocked before it is sent.
    expect(await source.write(edit, 5, false)).toEqual(
      err({ kind: 'schema-unreachable' })
    );
    expect(transport.get).toHaveBeenCalledTimes(2);
    expect(applyOps).toHaveBeenCalledTimes(1);

    transport.get.mockImplementation(() =>
      okAsync(detail('"Personal Guests"'))
    );
    expect(await source.write(edit, 5, false)).toEqual(
      ok({ insertedRowIds: [], version: 6 })
    );
    expect(transport.get).toHaveBeenCalledTimes(3);
    expect(applyOps).toHaveBeenCalledTimes(2);
    expect(applyOps).toHaveBeenLastCalledWith(
      nameEdit({ type: 'text', value: 'Grace' })
    );
  });

  it('calls the table unavailable only when its database is gone or no longer lists it', async () => {
    const applyOps = vi.fn<ApplyOps>(() => okAsync(written));
    const { source, client } = setup(detail(), applyOps);
    await waitFor(() => expect(source.loading()).toBe(false));
    const collision: DatabaseOpsError = {
      code: 'INVALID_OP',
      message: 'op 0, row 0, column name: no such column in this table',
      refusal: {
        message: 'op 0, row 0, column name: no such column in this table',
        op: 0,
        row: 0,
        column: 'name',
        taken: null,
      },
    };
    transport.get.mockImplementation(() =>
      errAsync([{ code: 'NOT_FOUND', message: 'Database not found' }])
    );
    applyOps.mockReturnValueOnce(errAsync(collision));

    expect(await source.write(edit, 5, false)).toEqual(
      err({ kind: 'ops', error: collision })
    );
    expect(await source.write(edit, 5, false)).toEqual(
      err({ kind: 'table-unavailable' })
    );

    client.setQueryData(databasesKeys.detail('db').queryKey, {
      ...detail(),
      tables: [],
    });
    transport.get.mockImplementation(() =>
      okAsync({ ...detail(), tables: [] })
    );
    expect(await source.write(edit, 5, false)).toEqual(
      err({ kind: 'table-unavailable' })
    );
    expect(applyOps).toHaveBeenCalledTimes(1);
  });

  it('recovers a read of a stale table through the refreshed schema', async () => {
    let refused = true;
    const { read, reads } = engine(() => {
      if (refused) {
        refused = false;
        throw {
          error: {
            stage: 'resolve',
            kind: 'unknownTable',
            name: 'guests',
            suggestion: null,
          },
          message: 'unknown table guests',
        };
      }
      return guests();
    });
    const { source } = setup(detail(), vi.fn(), { read });
    await waitFor(() =>
      expect(source.error()).toEqual({
        kind: 'engine',
        error: {
          stage: 'resolve',
          kind: 'unknownTable',
          name: 'guests',
          suggestion: null,
        },
        message: 'unknown table guests',
      })
    );
    transport.get.mockImplementation(() =>
      okAsync(detail('"Personal Guests"'))
    );

    await source.refresh();
    await waitFor(() => expect(source.error()).toBeUndefined());
    expect(transport.get).toHaveBeenCalledExactlyOnceWith({ id: 'db' });
    expect(reads).toEqual([
      { filter: null, sort: [] },
      { filter: null, sort: [] },
    ]);
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
    status.sql_name = '"Status"';
    status.definition.definition.id = 'status-definition';
    status.definition.definition.display_name = 'Status';
    initial.tables[0].columns.push(status);

    let version = 5;
    let persisted: { id: string; name: string; status: string | null }[] = [];
    let releaseCreate!: () => void;
    const createReady = new Promise<void>((resolve) => {
      releaseCreate = resolve;
    });
    const { read } = engine(() => ({
      ...guests([]),
      columns: [
        { name: 'Name', column: 'definition', kind: 'text' },
        { name: 'Status', column: 'status-definition', kind: 'text' },
      ],
      rows: persisted.map((row) => [
        { type: 'text', value: row.name },
        row.status === null ? null : { type: 'text', value: row.status },
      ]),
      rowIds: persisted.map((row) => row.id),
    }));
    const writes: DatabaseOp[][] = [];
    const applyOps = vi.fn<ApplyOps>((ops) => {
      writes.push(ops);
      const creating =
        ops[0]?.kind === 'rows' && ops[0].change.kind === 'insert';
      const applied = async (): Promise<OpResult[]> => {
        if (creating) await createReady;
        if (creating)
          persisted = [
            { id: 'server-record', name: 'Accepted record', status: null },
          ];
        // The cell's write creates the option it names, in one version.
        else persisted[0].status = 'In review';
        version += 1;
        return [
          {
            ...rowsWritten,
            tableVersion: version,
            change: creating
              ? { kind: 'inserted', rows: ['server-record'] }
              : { kind: 'updated', affected: 1 },
          },
        ];
      };
      return ResultAsync.fromSafePromise(applied());
    });
    const addOption = vi.fn<DatabaseRowsSource['addOption']>(() =>
      okAsync(undefined)
    );
    let drafts!: ReturnType<typeof createDraftRows>;
    let controller!: ReturnType<typeof createTableController>;
    const { source, unmount } = setup(initial, applyOps, {
      read,
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
    // The option is created by the write that first uses it.
    expect(addOption).not.toHaveBeenCalled();
    expect(writes).toEqual([
      nameInsert({ type: 'text', value: 'Accepted record' }),
      [
        {
          kind: 'rows',
          table: 'guests-table',
          change: {
            kind: 'update',
            changes: {
              kind: 'per_row',
              rows: [
                {
                  row: 'server-record',
                  cells: [
                    {
                      column: 'status',
                      value: { type: 'text', value: 'In review' },
                    },
                  ],
                },
              ],
            },
          },
        },
      ],
    ]);
    expect(source.snapshot()).toEqual({
      version: 7,
      rows: [
        {
          rowId: 'server-record',
          cells: { name: 'Accepted record', status: 'In review' },
        },
      ],
      retained: [],
    });
    expect(controller.failure()).toBeUndefined();
  });

  it('keeps the last actual read when a refresh fails after disposal', async () => {
    let offline = false;
    const { read } = engine(
      () => guests(),
      () => offline
    );
    const { source, client, unmount } = setup(detail(), vi.fn(), { read });
    await waitFor(() => expect(source.snapshot()?.version).toBe(5));
    unmount();
    const newerSchema = detail();
    newerSchema.tables[0].table.version = 6;
    client.setQueryData(databasesKeys.detail('db').queryKey, newerSchema);
    await source.refresh();
    expect(source.snapshot()?.version).toBe(6);

    newerSchema.tables[0].table.version = 10;
    client.setQueryData(databasesKeys.detail('db').queryKey, {
      ...newerSchema,
    });
    offline = true;
    expect(await source.refresh()).toEqual(
      err({ kind: 'fetch', message: expect.stringContaining('Offline') })
    );
    expect(source.snapshot()?.version).toBe(6);
    expect(source.snapshot()?.rows).toEqual([
      { rowId: 'record', cells: { name: 'Ada' } },
    ]);
  });
});

describe("another writer's change", () => {
  it('lands the new value with a full read when no local cache holds the rows', async () => {
    let name = 'Ada';
    const { read } = engine(() => guests([{ id: 'record', name }]));
    const since = vi.fn((_version: number) =>
      okAsync({
        version: 7,
        complete: true,
        truncated: false,
        rows: [{ row: 'record', kind: 'update' as const }],
        columns: [],
      })
    );
    const { source, tableChanged } = setup(detail(), vi.fn<ApplyOps>(), {
      read,
      changes: (readRows) => ({
        since,
        readRows,
        forget: () => okAsync(undefined),
      }),
    });
    await waitFor(() =>
      expect(source.snapshot()).toEqual({
        version: 5,
        rows: [{ rowId: 'record', cells: { name: 'Ada' } }],
        retained: [],
      })
    );

    name = 'Grace';
    tableChanged(7);

    await waitFor(() =>
      expect(source.snapshot()).toEqual({
        version: 7,
        rows: [{ rowId: 'record', cells: { name: 'Grace' } }],
        retained: [],
      })
    );
    expect(since).not.toHaveBeenCalled();
  });

  it('reads just the changed rows into the cache, then answers the view from it', async () => {
    let name = 'Ada';
    const engineRead = engine(() => guests([{ id: 'record', name }]));
    const host = {
      // The view's rerun must not wait on a cache notification.
      onCacheChanged: () => () => {},
      entityFilter: async () => ({ kind: 'unsupported' as const }),
      readRecordsByKeys: async () => ({
        revision: 'revision-1' as CacheRevision,
        records: [],
      }),
    } satisfies Pick<
      CacheHost,
      'onCacheChanged' | 'entityFilter' | 'readRecordsByKeys'
    >;
    const since = vi.fn((_version: number) =>
      okAsync({
        version: 7,
        complete: true,
        truncated: false,
        rows: [{ row: 'record', kind: 'update' as const }],
        columns: [],
      })
    );
    const { source, tableChanged } = setup(detail(), vi.fn<ApplyOps>(), {
      read: { ...engineRead.read, cacheHost: () => host },
      changes: (readRows) => ({
        since,
        readRows,
        forget: () => okAsync(undefined),
      }),
    });
    await waitFor(() =>
      expect(source.snapshot()).toEqual({
        version: 5,
        rows: [{ rowId: 'record', cells: { name: 'Ada' } }],
        retained: [],
      })
    );
    const beforePing = engineRead.reads.length;

    name = 'Grace';
    tableChanged(7);

    await waitFor(() =>
      expect(source.snapshot()).toEqual({
        version: 7,
        rows: [{ rowId: 'record', cells: { name: 'Grace' } }],
        retained: [],
      })
    );
    expect(since).toHaveBeenCalledExactlyOnceWith(5);
    expect(engineRead.reads.slice(beforePing)).toEqual([
      `SELECT * FROM "guests" WHERE row_id IN ('record')`,
      allGuests.query,
    ]);
  });
});

describe('an undo', () => {
  it('reads the table again, so the snapshot holds the reverted value', async () => {
    let name = 'Grace';
    const { read } = engine(() => guests([{ id: 'record', name }]));
    transport.undoChange.mockReturnValue(
      okAsync({
        outcome: {
          kind: 'reverted',
          changes: [{ change: 12, table: 'guests-table', version: 6 }],
        },
      })
    );
    const { source } = setup(detail(), vi.fn<ApplyOps>(), {
      read,
      onTableChanged: (listener) =>
        onDatabaseTableAdvanced((change) => {
          if (change.databaseId === 'db' && change.tableId === 'guests-table')
            listener(change.version);
        }),
    });
    await waitFor(() =>
      expect(source.snapshot()).toEqual({
        version: 5,
        rows: [{ rowId: 'record', cells: { name: 'Grace' } }],
        retained: [],
      })
    );

    name = 'Ada';
    const undone = await undoDatabaseChange('db', 11);

    expect(undone.isOk()).toBe(true);
    expect(transport.undoChange).toHaveBeenCalledExactlyOnceWith({
      id: 'db',
      change: 11,
    });
    await waitFor(() =>
      expect(source.snapshot()).toEqual({
        version: 6,
        rows: [{ rowId: 'record', cells: { name: 'Ada' } }],
        retained: [],
      })
    );
  });
});

describe('a refresh another read replaced', () => {
  it('leaves the read version where it was', async () => {
    const [view, setView] = createSignal(allGuests);
    let holding = false;
    let answerHeld: ((outcome: Outcome) => void) | undefined;
    const { read } = engine(() =>
      holding
        ? new Promise((resolve) => {
            answerHeld = resolve;
          })
        : guests()
    );
    const { source, client } = setup(detail(), vi.fn<ApplyOps>(), {
      read,
      view,
    });
    await waitFor(() => expect(source.snapshot()?.version).toBe(5));
    const newerSchema = detail();
    newerSchema.tables[0].table.version = 6;
    client.setQueryData(databasesKeys.detail('db').queryKey, newerSchema);
    await waitFor(() => expect(source.loading()).toBe(false));

    holding = true;
    const refreshed = source.refresh();
    await waitFor(() => expect(answerHeld).toBeDefined());
    holding = false;
    setView({
      ...allGuests,
      query: {
        filter: {
          conjunction: 'and',
          conditions: [
            {
              kind: 'condition',
              column: 'name',
              test: { kind: 'text', operator: 'contains', value: 'Ada' },
            },
          ],
        },
        sort: [],
      },
    });
    await waitFor(() => expect(source.loading()).toBe(false));
    answerHeld?.(guests());

    expect(await refreshed).toEqual(ok(undefined));
    expect(source.snapshot()).toEqual({
      version: 5,
      rows: [{ rowId: 'record', cells: { name: 'Ada' } }],
      retained: [],
    });
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
    ['12.5', 'NUMBER', { type: 'number', value: 12.5 }],
    ['00123', 'STRING', { type: 'text', value: '00123' }],
    ['hello', 'STRING', { type: 'text', value: 'hello' }],
  ] as const)(
    'settles the first %s entry and writes with the acknowledged schema version',
    async (value, type, cell) => {
      const initial = detail();
      initial.tables[0].columns[0].column.infer_type = true;
      const applyOps = vi.fn<ApplyOps>(() => okAsync(written));
      const { source, client } = setup(initial, applyOps);
      await waitFor(() => expect(source.loading()).toBe(false));
      transport.inferColumnType.mockImplementation(() =>
        okAsync({ column: inferredDetail(type), table_version: 6 })
      );
      applyOps.mockImplementation(() =>
        okAsync([{ ...rowsWritten, tableVersion: 7 }])
      );
      await source.write({ kind: 'create', values: { name: value } }, 5, false);
      expect(transport.inferColumnType).toHaveBeenCalledExactlyOnceWith({
        id: 'db',
        tableId: 'guests-table',
        columnId: 'name',
        request: { dataType: type, baseVersion: 5 },
      });
      expect(applyOps).toHaveBeenLastCalledWith(nameInsert(cell));
      expect(
        client.getQueryData<DatabaseDetail>(databasesKeys.detail('db').queryKey)
          ?.tables[0].columns[0].column.infer_type
      ).toBe(false);
    }
  );

  it('settles a column added then renamed against the version its rename returned', async () => {
    const applyOps = vi.fn<ApplyOps>(() => okAsync(written));
    const { source, client } = setup(detail(), applyOps);
    await waitFor(() => expect(source.snapshot()?.version).toBe(5));
    // The service: the add moves the table to 6, the rename to 7.
    let addedColumnId = '';
    transport.applyOps.mockImplementation(
      ({ request }: { request: { ops: DatabaseOp[] } }) => {
        const [op] = request.ops;
        if (op.kind !== 'column') throw new Error('expected a column op');
        if (op.change.kind === 'create') {
          addedColumnId = op.column;
          return okAsync({
            results: [
              {
                kind: 'column',
                table: 'guests-table',
                column: op.column,
                tableVersion: 6,
                change: { kind: 'created' },
              },
            ],
            changes: [{ change: 1, table: 'guests-table', version: 6 }],
          });
        }
        return okAsync({
          results: [
            {
              kind: 'column',
              table: 'guests-table',
              column: op.column,
              tableVersion: 7,
              change: { kind: 'renamed' },
            },
          ],
          changes: [{ change: 2, table: 'guests-table', version: 7 }],
        });
      }
    );

    const created = await createDatabaseColumn({
      databaseId: 'db',
      tableId: 'guests-table',
      name: 'Column',
      type: { type: 'text' },
      inferType: true,
    });
    expect(created).toEqual(ok(addedColumnId));
    // The app's schema read lands before the rename, at the add's version.
    const added = detail();
    added.tables[0].table.version = 6;
    added.tables[0].columns.push({
      shared_outside_database: false,
      column: {
        id: addedColumnId,
        table_id: 'guests-table',
        property_definition_id: 'q3-definition',
        position: 'b',
        config: null,
        display_name: null,
        infer_type: true,
      },
      sql_name: '"Column"',
      writable: true,
      definition: {
        definition: {
          id: 'q3-definition',
          owner: { scope: 'database', database_id: 'db' },
          display_name: 'Column',
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
    });
    client.setQueryData(databasesKeys.detail('db').queryKey, added);
    expect(
      (
        await renameDatabaseColumn({
          databaseId: 'db',
          tableId: 'guests-table',
          columnId: addedColumnId,
          name: 'Q3',
          previousName: 'Column',
        })
      ).isOk()
    ).toBe(true);

    transport.inferColumnType.mockImplementation(() =>
      okAsync({
        column: {
          shared_outside_database: false,
          column: {
            id: addedColumnId,
            table_id: 'guests-table',
            property_definition_id: 'q3-number-definition',
            position: 'b',
            config: null,
            display_name: 'Q3',
            infer_type: false,
          },
          sql_name: '"Q3"',
          writable: true,
          definition: {
            definition: {
              id: 'q3-number-definition',
              owner: { scope: 'database', database_id: 'db' },
              display_name: 'Column',
              data_type: 'NUMBER',
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
        table_version: 8,
      })
    );
    // The writer read the rows at 5; its own add and rename moved the table to 7.
    await source.write(
      { kind: 'cell', rowId: 'record', columnId: addedColumnId, value: '42' },
      5,
      false
    );
    expect(transport.inferColumnType).toHaveBeenCalledExactlyOnceWith({
      id: 'db',
      tableId: 'guests-table',
      columnId: addedColumnId,
      request: { dataType: 'NUMBER', baseVersion: 7 },
    });
    expect(applyOps).toHaveBeenLastCalledWith([
      {
        kind: 'rows',
        table: 'guests-table',
        change: {
          kind: 'update',
          changes: {
            kind: 'per_row',
            rows: [
              {
                row: 'record',
                cells: [
                  {
                    column: addedColumnId,
                    value: { type: 'number', value: 42 },
                  },
                ],
              },
            ],
          },
        },
      },
    ]);
  });

  it('uses the selected mention type and retains its entity ID', async () => {
    const initial = detail();
    initial.tables[0].columns[0].column.infer_type = true;
    const applyOps = vi.fn<ApplyOps>(() => okAsync(written));
    const { source } = setup(initial, applyOps);
    await waitFor(() => expect(source.loading()).toBe(false));
    transport.inferColumnType.mockImplementation(() =>
      okAsync({ column: inferredDetail('ENTITY', 'USER'), table_version: 6 })
    );
    await source.write(
      {
        kind: 'cell',
        rowId: 'record',
        columnId: 'name',
        value: 'macro|ada@example.com',
        columnTypes: { name: { dataType: 'ENTITY', entityType: 'USER' } },
      },
      5,
      false
    );
    expect(transport.inferColumnType.mock.calls[0][0].request).toEqual({
      dataType: 'ENTITY',
      specificEntityType: 'USER',
      baseVersion: 5,
    });
    expect(applyOps).toHaveBeenLastCalledWith(
      nameEdit({
        type: 'entities',
        value: [{ entityType: 'USER', entityId: 'macro|ada@example.com' }],
      })
    );
  });

  it('never infers a manually chosen text column or an empty value', async () => {
    const applyOps = vi.fn<ApplyOps>(() => okAsync(written));
    const { source } = setup(detail(), applyOps);
    await waitFor(() => expect(source.loading()).toBe(false));
    await source.write({ ...edit, value: '123' }, 5, false);
    expect(transport.inferColumnType).not.toHaveBeenCalled();
    expect(applyOps).toHaveBeenLastCalledWith(
      nameEdit({ type: 'text', value: '123' })
    );
  });

  it('after a competing first-entry type decision, writes the value against the refreshed column', async () => {
    const initial = detail();
    initial.tables[0].columns[0].column.infer_type = true;
    const applyOps = vi.fn<ApplyOps>(() => okAsync(written));
    const { source } = setup(initial, applyOps);
    await waitFor(() => expect(source.loading()).toBe(false));
    transport.inferColumnType.mockImplementation(() =>
      errAsync([{ code: 'CONFLICT', message: 'Column changed' }])
    );
    transport.get.mockImplementation(() => okAsync(detail()));
    await source.write({ ...edit, value: '123' }, 5, false);
    expect(transport.inferColumnType).toHaveBeenCalledOnce();
    expect(transport.get).toHaveBeenCalledOnce();
    expect(applyOps).toHaveBeenLastCalledWith(
      nameEdit({ type: 'text', value: '123' })
    );
  });

  it('settles the type again at the current version when the table moved since it was read', async () => {
    const initial = detail();
    initial.tables[0].columns[0].column.infer_type = true;
    const applyOps = vi.fn<ApplyOps>(() => okAsync(written));
    const { source } = setup(initial, applyOps);
    await waitFor(() => expect(source.loading()).toBe(false));
    transport.inferColumnType
      .mockReturnValueOnce(
        errAsync([
          { code: 'CONFLICT', message: 'The table changed since it was read' },
        ])
      )
      .mockReturnValueOnce(
        okAsync({ column: inferredDetail('NUMBER'), table_version: 10 })
      );
    const moved = detail();
    moved.tables[0].table.version = 9;
    moved.tables[0].columns[0].column.infer_type = true;
    transport.get.mockImplementation(() => okAsync(moved));

    expect(
      (await source.write({ ...edit, value: '42' }, 5, false)).isOk()
    ).toBe(true);
    expect(
      transport.inferColumnType.mock.calls.map(([call]) => call.request)
    ).toEqual([
      { dataType: 'NUMBER', baseVersion: 5 },
      { dataType: 'NUMBER', baseVersion: 9 },
    ]);
    expect(applyOps).toHaveBeenLastCalledWith(
      nameEdit({ type: 'number', value: 42 })
    );
  });

  it('writes a first value as text when its column type cannot be settled', async () => {
    const initial = detail();
    initial.tables[0].columns[0].column.infer_type = true;
    const applyOps = vi.fn<ApplyOps>(() => okAsync(written));
    const { source } = setup(initial, applyOps);
    await waitFor(() => expect(source.loading()).toBe(false));
    transport.inferColumnType.mockImplementation(() =>
      errAsync([
        { code: 'CONFLICT', message: 'The table changed since it was read' },
      ])
    );
    const moved = detail();
    moved.tables[0].table.version = 9;
    moved.tables[0].columns[0].column.infer_type = true;
    transport.get.mockImplementation(() => okAsync(moved));

    expect(
      (await source.write({ ...edit, value: '42' }, 5, false)).isOk()
    ).toBe(true);
    expect(transport.inferColumnType).toHaveBeenCalledTimes(2);
    expect(applyOps).toHaveBeenLastCalledWith(
      nameEdit({ type: 'text', value: '42' })
    );
  });

  it('retries a failed value write using its own completed type change without inferring again', async () => {
    const initial = detail();
    initial.tables[0].columns[0].column.infer_type = true;
    const applyOps = vi.fn<ApplyOps>(() => okAsync(written));
    const { source } = setup(initial, applyOps);
    await waitFor(() => expect(source.loading()).toBe(false));
    transport.inferColumnType.mockImplementation(() =>
      okAsync({ column: inferredDetail('NUMBER'), table_version: 6 })
    );
    const offline: DatabaseOpsError = {
      code: 'NETWORK_ERROR',
      message: 'Offline',
      refusal: null,
    };
    applyOps.mockReturnValueOnce(errAsync(offline));
    const mutation: DatabaseRowMutation = { ...edit, value: '12' };
    expect(await source.write(mutation, 5, false)).toEqual(
      err({ kind: 'ops', error: offline })
    );
    await source.write(mutation, 5, false);
    expect(transport.inferColumnType).toHaveBeenCalledOnce();
    expect(applyOps).toHaveBeenLastCalledWith(
      nameEdit({ type: 'number', value: 12 })
    );
  });
});
