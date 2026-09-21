import { afterEach, describe, expect, test } from 'bun:test';
import type { ExecOutcome } from '../generated/storage/types.gen';
import { Macro } from '../src/macro';

const originalFetch = globalThis.fetch;
const databaseId = '0198a4cc-e138-7670-a308-a6b766602700';
const tableId = '0198a4cc-e138-7670-a308-a6b766602701';
const columnId = '0198a4cc-e138-7670-a308-a6b766602702';
const host = 'https://storage.example.test';

function client() {
  return new Macro({ token: 'user-token', hosts: { storage: host } });
}

function schema(name = 'Tickets', columnName: string | null = 'Summary') {
  return {
    database: { id: databaseId, name: 'Support' },
    tables: [
      {
        table: { id: tableId, name, version: 7 },
        sql_name: 'tickets',
        read_sql_name: '_macro_table_stable',
        columns: [
          {
            column: { id: columnId, display_name: columnName },
            definition: { definition: { display_name: 'Name' } },
          },
        ],
      },
    ],
  };
}

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
  test('routes both query helpers through the server-enforced read-only endpoint', async () => {
    const requests: Request[] = [];
    const outcome: ExecOutcome = {
      results: [{ columns: [{ name: 'count' }], rows: [[12]] }],
      read_versions: { [tableId]: 7 },
      changes_applied: 0,
      inserted_row_ids: [],
      new_versions: {},
      read_database_ids: [databaseId],
      read_tables: [tableId],
      truncated_tables: [],
    };
    intercept((request) => {
      requests.push(request);
      return Response.json(outcome);
    });
    const macro = client();
    await expect(
      macro.databases.query('SELECT COUNT(*) FROM tickets')
    ).resolves.toEqual(outcome);
    await expect(
      macro.databases.byId(databaseId).query('SELECT COUNT(*) FROM tickets')
    ).resolves.toEqual(outcome.results);
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request.method).toBe('POST');
      expect(request.url).toBe(`${host}/databases/query`);
      expect(request.headers.get('authorization')).toBe('Bearer user-token');
      await expect(request.json()).resolves.toEqual({
        sql: 'SELECT COUNT(*) FROM tickets',
      });
    }
  });

  test('renames with the previously read table name, invalidates schema, and keeps stable read names', async () => {
    let currentName = 'Tickets';
    let reads = 0;
    let renameBody: unknown;
    intercept(async (request) => {
      if (request.method === 'PATCH') {
        expect(request.url).toBe(
          `${host}/databases/${databaseId}/tables/${tableId}`
        );
        renameBody = await request.json();
        currentName = 'Issues';
        return Response.json(schema(currentName).tables[0]?.table);
      }
      reads++;
      return Response.json(schema(currentName));
    });
    const table = await client().databases.byId(databaseId).table('Tickets');
    expect(table).toBeDefined();
    await expect(table?.readSqlName()).resolves.toBe('_macro_table_stable');
    await table?.rename('Issues');
    expect(renameBody).toEqual({ name: 'Issues', previousName: 'Tickets' });
    await expect(table?.name()).resolves.toBe('Issues');
    await expect(table?.readSqlName()).resolves.toBe('_macro_table_stable');
    expect(reads).toBe(2);
  });

  test('column rename uses its placement name and then reloads the placement', async () => {
    let currentName: string | null = null;
    let renameBody: unknown;
    intercept(async (request) => {
      if (request.method === 'PATCH') {
        expect(request.url).toBe(
          `${host}/databases/${databaseId}/tables/${tableId}/columns/${columnId}`
        );
        renameBody = await request.json();
        currentName = 'Summary';
        return Response.json({});
      }
      return Response.json(schema('Tickets', currentName));
    });
    const table = await client().databases.byId(databaseId).table('Tickets');
    const column = (await table?.columns())?.[0];
    expect(column).toBeDefined();
    await column?.rename('Summary');
    expect(renameBody).toEqual({ name: 'Summary', previousName: 'Name' });
    await expect(column?.name()).resolves.toBe('Summary');
  });

  test('forwards first-value inference version and rejects another database handle', async () => {
    const requests: Request[] = [];
    intercept((request) => {
      requests.push(request);
      return Response.json(
        request.method === 'GET' ? schema() : { version: 8 }
      );
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
      data_type: 'ENTITY',
      specific_entity_type: 'USER',
      base_version: 7,
    });
    await expect(
      macro.databases
        .byId('other')
        .inferColumnType(column, { dataType: 'NUMBER', baseVersion: 7 })
    ).rejects.toThrow('does not belong');
    expect(requests).toHaveLength(2);
  });

  test('guards type, ordering and deletion writes with explicit table versions', async () => {
    const writes: { url: string; method: string; body: unknown }[] = [];
    let reads = 0;
    intercept(async (request) => {
      if (request.method === 'GET') {
        reads++;
        return Response.json(schema());
      }
      writes.push({
        url: request.url,
        method: request.method,
        body: await request.json(),
      });
      return Response.json({ version: 8 });
    });
    const database = client().databases.byId(databaseId);
    const table = await database.table('Tickets');
    const column = (await table?.columns())?.[0];
    if (!table || !column) throw new Error('Missing fixture column');
    await column.changeType({
      dataType: 'STRING',
      isMultiSelect: false,
      baseVersion: 7,
    });
    await table.reorderColumns([column.id], 8);
    await column.delete(9);
    expect(writes).toEqual([
      {
        method: 'PATCH',
        url: `${host}/databases/${databaseId}/tables/${tableId}/columns/${columnId}/type`,
        body: { dataType: 'STRING', isMultiSelect: false, baseVersion: 7 },
      },
      {
        method: 'PATCH',
        url: `${host}/databases/${databaseId}/tables/${tableId}/columns/order`,
        body: { columnIds: [columnId], baseVersion: 8 },
      },
      {
        method: 'DELETE',
        url: `${host}/databases/${databaseId}/tables/${tableId}/columns/${columnId}`,
        body: { baseVersion: 9 },
      },
    ]);
    await database.schema();
    expect(reads).toBe(2);
    await expect(
      client().databases.byId('other').deleteColumn(column, 9)
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
    expect(writes.slice(0, 2)).toEqual(
      [0, 1].map(() => ({
        url: `${host}/databases/${databaseId}/import`,
        body: request,
      }))
    );
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
});
