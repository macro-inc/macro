import { afterEach, describe, expect, test } from 'bun:test';
import type {
  ColumnCast,
  DatabaseDetail,
  Table,
} from '../generated/storage/types.gen';
import { Macro, MacroOpRefusedError } from '../src/macro';

const originalFetch = globalThis.fetch;
const databaseId = '0198a4cc-e138-7670-a308-a6b766602700';
const tableId = '0198a4cc-e138-7670-a308-a6b766602701';
const columnId = '0198a4cc-e138-7670-a308-a6b766602702';
const definitionId = '0198a4cc-e138-7670-a308-a6b766602709';
const host = 'https://storage.example.test';

function client() {
  return new Macro({ token: 'user-token', hosts: { storage: host } });
}

const ticketsTable: Table = {
  id: tableId,
  database_id: databaseId,
  name: 'Tickets',
  position: 'a0',
  version: 7,
};

/** One table, Tickets, whose one column is bound to the "Name" definition. */
const support: DatabaseDetail = {
  database: {
    id: databaseId,
    name: 'Support',
    owner_id: 'owner',
    created_at: '2026-10-01T00:00:00Z',
    trashed_at: null,
  },
  grant: 'owner',
  tables: [
    {
      table: ticketsTable,
      sql_name: 'tickets',
      views: [],
      columns: [
        {
          column: {
            id: columnId,
            table_id: tableId,
            property_definition_id: definitionId,
            display_name: null,
            position: 'a0',
            infer_type: false,
            config: null,
          },
          definition: {
            definition: {
              id: definitionId,
              display_name: 'Name',
              data_type: 'STRING',
              is_multi_select: false,
              specific_entity_type: null,
              is_metadata: false,
              is_system: false,
              owner: { scope: 'database', database_id: databaseId },
              created_at: '2026-10-01T00:00:00Z',
              updated_at: '2026-10-01T00:00:00Z',
            },
            property_options: [],
          },
          shared_outside_database: false,
          sql_name: 'name',
          writable: true,
        },
      ],
    },
  ],
};

function intercept(
  respond: (request: Request) => Response | Promise<Response>
) {
  globalThis.fetch = (async (input) =>
    respond(
      input instanceof Request ? input : new Request(input)
    )) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('Database', () => {
  test('renames a table by op with the previously read name and reloads the schema', async () => {
    let current = support;
    let reads = 0;
    const writes: { url: string; method: string; body: unknown }[] = [];
    intercept(async (request) => {
      if (request.method === 'POST') {
        writes.push({
          url: request.url,
          method: request.method,
          body: await request.json(),
        });
        const renamed: Table = { ...ticketsTable, name: 'Issues', version: 8 };
        current = {
          ...support,
          tables: support.tables.map((table) => ({ ...table, table: renamed })),
        };
        return Response.json({
          results: [
            {
              kind: 'table',
              table: tableId,
              tableVersion: 8,
              change: { kind: 'renamed' },
            },
          ],
        });
      }
      reads++;
      return Response.json(current);
    });
    const table = await client().databases.byId(databaseId).table('Tickets');
    if (!table) throw new Error('Missing fixture table');
    expect(await table.database.renameTable(table, 'Issues')).toBe(8);
    expect(writes).toEqual([
      {
        method: 'POST',
        url: `${host}/databases/${databaseId}/ops`,
        body: {
          ops: [
            {
              kind: 'table',
              table: tableId,
              change: {
                kind: 'rename',
                name: 'Issues',
                previousName: 'Tickets',
              },
            },
          ],
        },
      },
    ]);
    await expect(table.name()).resolves.toBe('Issues');
    expect(reads).toBe(2);
  });

  test('renames a column by op with its placement name and then reloads the placement', async () => {
    let current = support;
    let renameBody: unknown;
    intercept(async (request) => {
      if (request.method === 'POST') {
        expect(request.url).toBe(`${host}/databases/${databaseId}/ops`);
        renameBody = await request.json();
        current = {
          ...support,
          tables: support.tables.map((table) => ({
            ...table,
            columns: table.columns.map((column) => ({
              ...column,
              column: { ...column.column, display_name: 'Summary' },
            })),
          })),
        };
        return Response.json({
          results: [
            {
              kind: 'column',
              table: tableId,
              column: columnId,
              tableVersion: 8,
              change: { kind: 'renamed' },
            },
          ],
        });
      }
      return Response.json(current);
    });
    const table = await client().databases.byId(databaseId).table('Tickets');
    const column = (await table?.columns())?.[0];
    if (!column) throw new Error('Missing fixture column');
    await column.rename('Summary');
    expect(renameBody).toEqual({
      ops: [
        {
          kind: 'column',
          table: tableId,
          column: columnId,
          change: { kind: 'rename', name: 'Summary', previousName: 'Name' },
        },
      ],
    });
    await expect(column.name()).resolves.toBe('Summary');
  });

  test('forwards first-value inference version and rejects another database handle', async () => {
    const requests: Request[] = [];
    intercept((request) => {
      requests.push(request);
      return Response.json(request.method === 'GET' ? support : { version: 8 });
    });
    const macro = client();
    const database = macro.databases.byId(databaseId);
    const table = await database.table('Tickets');
    const column = (await table?.columns())?.[0];
    if (!column) throw new Error('Missing fixture column');
    await column.inferType({
      dataType: 'ENTITY',
      specificEntityType: 'USER',
      baseVersion: 7,
    });
    expect(requests[1]?.url).toBe(
      `${host}/databases/${databaseId}/tables/${tableId}/columns/${columnId}/infer-type`
    );
    await expect(requests[1]?.json()).resolves.toEqual({
      dataType: 'ENTITY',
      specificEntityType: 'USER',
      baseVersion: 7,
    });
    await expect(
      macro.databases
        .byId('other')
        .inferColumnType(column, { dataType: 'NUMBER', baseVersion: 7 })
    ).rejects.toThrow('does not belong');
    expect(requests).toHaveLength(2);
  });

  test('guards type, ordering and deletion ops with the table version last read', async () => {
    const writes: { url: string; method: string; body: unknown }[] = [];
    let reads = 0;
    intercept(async (request) => {
      if (request.method === 'GET') {
        reads++;
        return Response.json(support);
      }
      writes.push({
        url: request.url,
        method: request.method,
        body: await request.json(),
      });
      return Response.json({
        results: [
          [
            {
              kind: 'column',
              table: tableId,
              column: columnId,
              tableVersion: 8,
              change: { kind: 'type_changed' },
            },
          ],
          [
            {
              kind: 'table',
              table: tableId,
              tableVersion: 9,
              change: { kind: 'columns_reordered' },
            },
          ],
          [
            {
              kind: 'column',
              table: tableId,
              column: columnId,
              tableVersion: 10,
              change: { kind: 'deleted' },
            },
          ],
        ][writes.length - 1],
      });
    });
    const database = client().databases.byId(databaseId);
    const table = await database.table('Tickets');
    const column = (await table?.columns())?.[0];
    if (!table || !column) throw new Error('Missing fixture column');
    const outcome = await column.changeType({
      to: { type: 'relation', table },
    });
    expect(outcome).toEqual({
      kind: 'column',
      table: tableId,
      column: columnId,
      tableVersion: 8,
      change: { kind: 'type_changed' },
    });
    expect(await table.database.reorderColumns(table, [column])).toBe(9);
    expect(await column.table.database.deleteColumn(column)).toBe(10);
    expect(writes).toEqual([
      {
        method: 'POST',
        url: `${host}/databases/${databaseId}/ops`,
        body: {
          ops: [
            {
              kind: 'column',
              table: tableId,
              column: columnId,
              change: {
                kind: 'change_type',
                to: { type: 'relation', database: databaseId, table: tableId },
              },
            },
          ],
          baseVersions: { [tableId]: 7 },
        },
      },
      {
        method: 'POST',
        url: `${host}/databases/${databaseId}/ops`,
        body: {
          ops: [
            {
              kind: 'table',
              table: tableId,
              change: { kind: 'reorder_columns', order: [columnId] },
            },
          ],
          baseVersions: { [tableId]: 7 },
        },
      },
      {
        method: 'POST',
        url: `${host}/databases/${databaseId}/ops`,
        body: {
          ops: [
            {
              kind: 'column',
              table: tableId,
              column: columnId,
              change: { kind: 'delete' },
            },
          ],
          baseVersions: { [tableId]: 7 },
        },
      },
    ]);
    await database.schema();
    expect(reads).toBe(4);
    await expect(
      client().databases.byId('other').deleteColumn(column)
    ).rejects.toThrow('does not belong');
    expect(writes).toHaveLength(3);
  });

  test('keeps the import identity and exposes owner-managed recipient grants', async () => {
    const writes: { url: string; body: unknown }[] = [];
    const permissions = {
      id: databaseId,
      owner: 'owner',
      channelSharePermissions: [],
    };
    intercept(async (request) => {
      if (request.method !== 'GET')
        writes.push({ url: request.url, body: await request.json() });
      return Response.json(
        request.url.endsWith('/import') ? { id: tableId } : permissions
      );
    });
    const database = client().databases.byId(databaseId);
    const request = {
      requestId: '0198a4cc-e138-7670-a308-a6b766602703',
      name: 'Contacts',
      columns: ['Name', 'Postal code'],
      rows: [['Ada', '00123']],
    };
    expect((await database.importTable(request)).id).toBe(tableId);
    expect((await database.importTable(request)).id).toBe(tableId);
    expect(writes.slice(0, 2)).toEqual([
      { url: `${host}/databases/${databaseId}/import`, body: request },
      { url: `${host}/databases/${databaseId}/import`, body: request },
    ]);
    expect(await database.sharePermissions()).toEqual(permissions);
    const grants = {
      channelSharePermissions: [
        {
          operation: 'add' as const,
          channelId: 'channel',
          accessLevel: 'view' as const,
        },
      ],
    };
    expect(await database.updateSharePermissions(grants)).toEqual(permissions);
    expect(writes[2]).toEqual({
      url: `${host}/databases/${databaseId}/permissions`,
      body: grants,
    });
  });

  test('applies ops in one request and returns one result per op', async () => {
    const rowId = '0198a4cc-e138-7670-a308-a6b766602704';
    const writes: { url: string; method: string; body: unknown }[] = [];
    intercept(async (request) => {
      writes.push({
        url: request.url,
        method: request.method,
        body: await request.json(),
      });
      return Response.json({
        results: [
          {
            kind: 'rows',
            table: tableId,
            tableVersion: 8,
            change: { kind: 'inserted', rows: [rowId] },
          },
          {
            kind: 'rows',
            table: tableId,
            tableVersion: 8,
            change: { kind: 'deleted', affected: 1 },
          },
        ],
      });
    });
    const database = client().databases.byId(databaseId);
    const results = await database.applyOps([
      {
        kind: 'rows',
        table: tableId,
        change: {
          kind: 'insert',
          rows: [
            [
              {
                column: columnId,
                value: { type: 'text', value: 'Printer jam' },
              },
            ],
          ],
        },
      },
      {
        kind: 'rows',
        table: tableId,
        change: { kind: 'delete', rows: [rowId] },
      },
    ]);
    expect(writes).toEqual([
      {
        method: 'POST',
        url: `${host}/databases/${databaseId}/ops`,
        body: {
          ops: [
            {
              kind: 'rows',
              table: tableId,
              change: {
                kind: 'insert',
                rows: [
                  [
                    {
                      column: columnId,
                      value: { type: 'text', value: 'Printer jam' },
                    },
                  ],
                ],
              },
            },
            {
              kind: 'rows',
              table: tableId,
              change: { kind: 'delete', rows: [rowId] },
            },
          ],
        },
      },
    ]);
    expect(results).toEqual([
      {
        kind: 'rows',
        table: tableId,
        tableVersion: 8,
        change: { kind: 'inserted', rows: [rowId] },
      },
      {
        kind: 'rows',
        table: tableId,
        tableVersion: 8,
        change: { kind: 'deleted', affected: 1 },
      },
    ]);
  });

  test('reorders tables by handle, deletes one, and reloads the schema after each', async () => {
    const otherTableId = '0198a4cc-e138-7670-a308-a6b766602705';
    const writes: { url: string; method: string; body: unknown }[] = [];
    let reads = 0;
    intercept(async (request) => {
      if (request.method === 'GET') {
        reads++;
        return Response.json({
          database: { id: databaseId, name: 'Support' },
          tables: [
            { table: { id: tableId, name: 'Tickets' }, columns: [], views: [] },
            {
              table: { id: otherTableId, name: 'Customers' },
              columns: [],
              views: [],
            },
          ],
        });
      }
      writes.push({
        url: request.url,
        method: request.method,
        body: await request.json(),
      });
      return Response.json({
        results: [
          writes.length === 1
            ? {
                kind: 'reorder_tables',
                tables: [
                  { table: otherTableId, version: 3 },
                  { table: tableId, version: 8 },
                ],
              }
            : {
                kind: 'table',
                table: otherTableId,
                change: { kind: 'deleted' },
              },
        ],
      });
    });
    const database = client().databases.byId(databaseId);
    const [tickets, customers] = await database.tables();
    if (!tickets || !customers) throw new Error('Missing fixture tables');
    const reordered = await database.reorderTables([customers, tickets]);
    expect(reordered.map((table) => table.id)).toEqual([otherTableId, tableId]);
    expect(reordered[0]?.database).toBe(database);
    await database.schema();
    await customers.delete();
    await database.schema();
    expect(writes).toEqual([
      {
        method: 'POST',
        url: `${host}/databases/${databaseId}/ops`,
        body: {
          ops: [{ kind: 'reorder_tables', order: [otherTableId, tableId] }],
        },
      },
      {
        method: 'POST',
        url: `${host}/databases/${databaseId}/ops`,
        body: {
          ops: [
            { kind: 'table', table: otherTableId, change: { kind: 'delete' } },
          ],
        },
      },
    ]);
    expect(reads).toBe(3);
    await expect(
      client().databases.byId('other').reorderTables([tickets])
    ).rejects.toThrow('does not belong');
    await expect(
      client().databases.byId('other').deleteTable(tickets)
    ).rejects.toThrow('does not belong');
    expect(writes).toHaveLength(2);
  });

  test('creates a table under a client-minted UUIDv7 and returns its handle', async () => {
    let createBody: unknown;
    let mintedId = '';
    intercept(async (request) => {
      createBody = await request.json();
      mintedId =
        (createBody as { ops: { table: string }[] }).ops[0]?.table ?? '';
      return Response.json({
        results: [
          {
            kind: 'table',
            table: mintedId,
            tableVersion: 1,
            change: { kind: 'created' },
          },
        ],
      });
    });
    const database = client().databases.byId(databaseId);
    const table = await database.createTable({ name: 'Guests' });
    expect(createBody).toEqual({
      ops: [
        {
          kind: 'table',
          table: expect.stringMatching(
            /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
          ),
          change: { kind: 'create', name: 'Guests' },
        },
      ],
    });
    expect(table.id).toBe(mintedId);
    expect(table.database).toBe(database);
  });

  test('adds a select column after another, minting the column and option ids', async () => {
    const writes: unknown[] = [];
    intercept(async (request) => {
      if (request.method === 'GET') return Response.json(support);
      const body = await request.json();
      writes.push(body);
      const [op] = (body as { ops: { column: string }[] }).ops;
      return Response.json({
        results: [
          {
            kind: 'column',
            table: tableId,
            column: op?.column,
            tableVersion: 8,
            change: { kind: 'created' },
          },
        ],
      });
    });
    const table = await client().databases.byId(databaseId).table('Tickets');
    const name = (await table?.columns())?.[0];
    if (!table || !name) throw new Error('Missing fixture column');
    const status = await table.addColumn({
      name: 'Status',
      type: { type: 'select', multi: false },
      options: ['Open', 'Closed'],
      after: name,
    });
    const v7 =
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(writes).toEqual([
      {
        ops: [
          {
            kind: 'column',
            table: tableId,
            column: expect.stringMatching(v7),
            change: {
              kind: 'create',
              definition: {
                source: 'new',
                name: 'Status',
                type: { type: 'select', multi: false },
                options: [
                  { id: expect.stringMatching(v7), label: 'Open' },
                  { id: expect.stringMatching(v7), label: 'Closed' },
                ],
              },
              after: columnId,
            },
          },
        ],
      },
    ]);
    const [op] = (writes[0] as { ops: { column: string }[] }).ops;
    expect(status.id).toBe(op?.column ?? '');
    expect(status.table).toBe(table);
  });

  test('converts a column into a new one after it: one conversion read, then one batch creating and filling it at the read version', async () => {
    const firstRow = '0198a4cc-e138-7670-a308-a6b76660270a';
    const secondRow = '0198a4cc-e138-7670-a308-a6b76660270b';
    const writes: { url: string; body: unknown }[] = [];
    intercept(async (request) => {
      if (request.method === 'GET') return Response.json(support);
      const body = await request.json();
      writes.push({ url: request.url, body });
      if (request.url.endsWith('/conversion'))
        return Response.json({
          tableVersion: 9,
          options: ['Open', 'Closed'],
          cells: [
            {
              row: firstRow,
              value: { type: 'options', value: [{ label: 'Open' }] },
            },
            {
              row: secondRow,
              value: { type: 'options', value: [{ label: 'Closed' }] },
            },
          ],
          misfits: 1,
        });
      const [op] = (body as { ops: { column: string }[] }).ops;
      return Response.json({
        results: [
          {
            kind: 'column',
            table: tableId,
            column: op?.column,
            tableVersion: 10,
            change: { kind: 'created' },
          },
          {
            kind: 'rows',
            table: tableId,
            tableVersion: 10,
            change: { kind: 'updated', affected: 2 },
          },
        ],
      });
    });
    const table = await client().databases.byId(databaseId).table('Tickets');
    const name = (await table?.columns())?.[0];
    if (!table || !name) throw new Error('Missing fixture column');
    const converted = await name.convertIntoNewColumn({
      to: { type: 'select', multi: false },
    });
    const v7 =
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    const batch = writes[1]?.body as { ops: { column: string }[] };
    const newColumn = batch.ops[0]?.column ?? '';
    expect(writes).toEqual([
      {
        url: `${host}/databases/${databaseId}/tables/${tableId}/columns/${columnId}/conversion`,
        body: { to: { type: 'select', multi: false } },
      },
      {
        url: `${host}/databases/${databaseId}/ops`,
        body: {
          ops: [
            {
              kind: 'column',
              table: tableId,
              column: expect.stringMatching(v7),
              change: {
                kind: 'create',
                definition: {
                  source: 'new',
                  name: 'Name (Select)',
                  type: { type: 'select', multi: false },
                  options: [
                    { id: expect.stringMatching(v7), label: 'Open' },
                    { id: expect.stringMatching(v7), label: 'Closed' },
                  ],
                },
                after: columnId,
              },
            },
            {
              kind: 'rows',
              table: tableId,
              change: {
                kind: 'update',
                changes: {
                  kind: 'per_row',
                  rows: [
                    {
                      row: firstRow,
                      cells: [
                        {
                          column: newColumn,
                          value: {
                            type: 'options',
                            value: [{ label: 'Open' }],
                          },
                        },
                      ],
                    },
                    {
                      row: secondRow,
                      cells: [
                        {
                          column: newColumn,
                          value: {
                            type: 'options',
                            value: [{ label: 'Closed' }],
                          },
                        },
                      ],
                    },
                  ],
                },
              },
            },
          ],
          baseVersions: { [tableId]: 9 },
        },
      },
    ]);
    expect(converted.id).toBe(newColumn);
    expect(converted.table).toBe(table);
  });

  test('converts a column with no convertible values into an empty new column under the given name, with no row update', async () => {
    const writes: { url: string; body: unknown }[] = [];
    intercept(async (request) => {
      if (request.method === 'GET') return Response.json(support);
      const body = await request.json();
      writes.push({ url: request.url, body });
      if (request.url.endsWith('/conversion'))
        return Response.json({
          tableVersion: 7,
          options: [],
          cells: [],
          misfits: 3,
        });
      const [op] = (body as { ops: { column: string }[] }).ops;
      return Response.json({
        results: [
          {
            kind: 'column',
            table: tableId,
            column: op?.column,
            tableVersion: 8,
            change: { kind: 'created' },
          },
        ],
      });
    });
    const table = await client().databases.byId(databaseId).table('Tickets');
    const name = (await table?.columns())?.[0];
    if (!name) throw new Error('Missing fixture column');
    await name.convertIntoNewColumn({ to: { type: 'number' }, name: 'Score' });
    expect(writes[1]).toEqual({
      url: `${host}/databases/${databaseId}/ops`,
      body: {
        ops: [
          {
            kind: 'column',
            table: tableId,
            column: expect.stringMatching(
              /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
            ),
            change: {
              kind: 'create',
              definition: {
                source: 'new',
                name: 'Score',
                type: { type: 'number' },
                options: [],
              },
              after: columnId,
            },
          },
        ],
        baseVersions: { [tableId]: 7 },
      },
    });
  });

  test('binds a column to an existing property definition by handle', async () => {
    let createBody: unknown;
    intercept(async (request) => {
      if (request.method === 'GET') return Response.json(support);
      createBody = await request.json();
      return Response.json({
        results: [
          {
            kind: 'column',
            table: tableId,
            column: columnId,
            tableVersion: 8,
            change: { kind: 'created' },
          },
        ],
      });
    });
    const macro = client();
    const table = await macro.databases.byId(databaseId).table('Tickets');
    if (!table) throw new Error('Missing fixture table');
    const column = await table.addColumn({
      property: macro.properties.definition(definitionId),
    });
    expect(createBody).toEqual({
      ops: [
        {
          kind: 'column',
          table: tableId,
          column: expect.stringMatching(
            /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
          ),
          change: {
            kind: 'create',
            definition: { source: 'existing', property: definitionId },
          },
        },
      ],
    });
    expect(column.id).toBe(columnId);
  });

  test('adds select options under minted ids and returns the ones created', async () => {
    const optionId = '0198a4cc-e138-7670-a308-a6b76660270c';
    let addBody: unknown;
    intercept(async (request) => {
      if (request.method === 'GET') return Response.json(support);
      addBody = await request.json();
      return Response.json({
        results: [
          {
            kind: 'column',
            table: tableId,
            column: columnId,
            tableVersion: 8,
            change: { kind: 'options_added', added: [optionId] },
          },
        ],
      });
    });
    const database = client().databases.byId(databaseId);
    const column = (await (await database.table('Tickets'))?.columns())?.[0];
    if (!column) throw new Error('Missing fixture column');
    expect(await database.addColumnOptions(column, ['Maybe'])).toEqual({
      kind: 'column',
      table: tableId,
      column: columnId,
      tableVersion: 8,
      change: { kind: 'options_added', added: [optionId] },
    });
    expect(addBody).toEqual({
      ops: [
        {
          kind: 'column',
          table: tableId,
          column: columnId,
          change: {
            kind: 'add_options',
            options: [
              {
                id: expect.stringMatching(
                  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
                ),
                label: 'Maybe',
              },
            ],
          },
        },
      ],
    });
  });

  test('sends base versions by table handle with applied ops', async () => {
    let opsBody: unknown;
    intercept(async (request) => {
      if (request.method === 'GET') return Response.json(support);
      opsBody = await request.json();
      return Response.json({
        results: [
          {
            kind: 'view',
            table: tableId,
            view: '0198a4cc-e138-7670-a308-a6b766602706',
            tableVersion: 8,
            change: { kind: 'deleted' },
          },
        ],
      });
    });
    const database = client().databases.byId(databaseId);
    const table = await database.table('Tickets');
    if (!table) throw new Error('Missing fixture table');
    const viewId = '0198a4cc-e138-7670-a308-a6b766602706';
    await database.applyOps(
      [
        {
          kind: 'view',
          table: tableId,
          view: viewId,
          change: { kind: 'delete' },
        },
      ],
      { baseVersions: [{ table, version: 7 }] }
    );
    expect(opsBody).toEqual({
      ops: [
        {
          kind: 'view',
          table: tableId,
          view: viewId,
          change: { kind: 'delete' },
        },
      ],
      baseVersions: { [tableId]: 7 },
    });
  });

  test('throws a refusal naming the op and the taken id, and keeps the cached schema', async () => {
    let reads = 0;
    intercept((request) => {
      if (request.method === 'GET') {
        reads++;
        return Response.json(support);
      }
      return Response.json(
        {
          message: 'table id already taken',
          op: 0,
          row: null,
          column: null,
          taken: { kind: 'table', id: tableId },
        },
        { status: 400 }
      );
    });
    const database = client().databases.byId(databaseId);
    await database.schema();
    const refusal = await database
      .createTable({ name: 'Guests' })
      .catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(MacroOpRefusedError);
    expect(refusal).toMatchObject({
      status: 400,
      message: 'table id already taken',
      op: 0,
      row: null,
      column: null,
      taken: { kind: 'table', id: tableId },
    });
    await database.schema();
    expect(reads).toBe(1);
  });

  test('lists what a column can be cast to', async () => {
    const casts: ColumnCast[] = [
      {
        data_type: 'NUMBER',
        is_multi_select: false,
        specific_entity_type: null,
        relation: false,
        cast: 'checked',
        failures: 2,
        examples: ['n/a', 'soon'],
        summary: "2 values aren't numbers",
        reason: null,
      },
    ];
    const urls: string[] = [];
    intercept((request) => {
      urls.push(request.url);
      return Response.json(request.url.endsWith('/casts') ? casts : support);
    });
    const table = await client().databases.byId(databaseId).table('Tickets');
    const column = (await table?.columns())?.[0];
    if (!column) throw new Error('Missing fixture column');
    expect(await column.casts()).toEqual(casts);
    expect(urls[1]).toBe(
      `${host}/databases/${databaseId}/tables/${tableId}/columns/${columnId}/casts`
    );
  });

  test("exposes a table's views as handles and reads a board's card positions", async () => {
    const viewId = '0198a4cc-e138-7670-a308-a6b766602706';
    const rowId = '0198a4cc-e138-7670-a308-a6b766602707';
    const optionId = '0198a4cc-e138-7670-a308-a6b766602708';
    const board = {
      id: viewId,
      databaseId,
      tableId,
      name: 'By status',
      position: 'a0',
      query: { filter: null, sort: [] },
      layout: {
        kind: 'board',
        groupBy: columnId,
        title: columnId,
        cardFields: [columnId],
        hideEmptyLanes: false,
        lanes: [{ key: { kind: 'option', id: optionId } }],
      },
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-10-01T00:00:00Z',
    };
    const urls: string[] = [];
    intercept((request) => {
      urls.push(request.url);
      if (request.url.endsWith('/positions'))
        return Response.json({
          positions: [
            {
              row: rowId,
              lane: { kind: 'option', id: optionId },
              position: 'a0',
            },
          ],
        });
      return Response.json({
        database: { id: databaseId, name: 'Support' },
        tables: [
          {
            table: { id: tableId, name: 'Tickets' },
            columns: [],
            views: [board],
          },
        ],
      });
    });
    const table = await client().databases.byId(databaseId).table('Tickets');
    if (!table) throw new Error('Missing fixture table');
    const views = await table.views();
    expect(views.map((view) => view.id)).toEqual([viewId]);
    const view = views[0];
    if (!view) throw new Error('Missing fixture view');
    expect(view.table).toBe(table);
    await expect(view.name()).resolves.toBe('By status');
    await expect(view.position()).resolves.toBe('a0');
    await expect(view.layout()).resolves.toEqual({
      kind: 'board',
      groupBy: columnId,
      title: columnId,
      cardFields: [columnId],
      hideEmptyLanes: false,
      lanes: [{ key: { kind: 'option', id: optionId } }],
    });
    await expect(view.query()).resolves.toEqual({ filter: null, sort: [] });
    expect(await view.positions()).toEqual([
      { row: rowId, lane: { kind: 'option', id: optionId }, position: 'a0' },
    ]);
    expect(urls).toEqual([
      `${host}/databases/${databaseId}`,
      `${host}/databases/${databaseId}/views/${viewId}/positions`,
    ]);
  });
});
