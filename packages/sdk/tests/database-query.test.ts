import { afterEach, expect, test } from 'bun:test';
import { DatabaseTable } from '../src/entities/databases/table';
import { Macro } from '../src/macro';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const selected = {
  tableDatabases: { 'table-1': 'db-1', 'table-2': 'db-2' },
  result: {
    sourceTable: 'table-1',
    columns: [{ name: 'Name', kind: 'text', relatedTable: 'table-2' }],
    rows: [[{ type: 'text', value: 'Sam' }]],
    rowIds: ['row-1'],
  },
  changesApplied: 0,
  insertedRowIds: [],
  newVersions: {},
  readVersions: { 'table-1': 3, 'table-2': 8 },
  truncatedTables: ['Guests'],
  statement: { kind: 'select' },
};

test('SQL queries hydrate source rows, cross-database relations and reusable version guards', async () => {
  const requests: Request[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      requests.push(request);
      return Response.json(selected);
    },
    { preconnect: originalFetch.preconnect },
  );
  const macro = new Macro({
    token: 'token',
    hosts: { storage: 'https://storage.test' },
  });
  const database = macro.databases.byId('db-1');
  const result = await database.query('SELECT Name FROM Guests');
  expect(new URL(requests[0].url).pathname).toBe('/databases/query');
  expect(requests[0].headers.get('Authorization')).toBe('Bearer token');
  expect(await requests[0].json()).toEqual({
    sql: 'SELECT Name FROM Guests',
    databaseId: 'db-1',
    baseVersions: {},
  });
  expect(result.result?.rowHandles[0].table.database).toBe(database);
  expect(result.result?.rowHandles[0].id).toBe('row-1');
  expect(result.result?.columns[0].relatedTable?.database.id).toBe('db-2');
  expect(
    result.readVersions.map(({ table, version }) => [
      table.id,
      table.database.id,
      version,
    ]),
  ).toEqual([
    ['table-1', 'db-1', 3],
    ['table-2', 'db-2', 8],
  ]);
  expect(result.truncatedTables).toEqual(['Guests']);
  await macro.databases.query('SELECT Name FROM Guests', {
    database,
    baseVersions: result.readVersions,
  });
  expect(await requests[1].json()).toEqual({
    sql: 'SELECT Name FROM Guests',
    databaseId: 'db-1',
    baseVersions: { 'table-1': 3, 'table-2': 8 },
  });
});

test('successful SQL writes return inserted row handles and invalidate the scoped schema', async () => {
  let reads = 0;
  let writes = 0;
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      if (request.method === 'GET') {
        reads++;
        return Response.json({
          database: { id: 'db-1', name: reads === 1 ? 'Before' : 'After' },
          tables: [],
        });
      }
      writes++;
      if (writes === 2)
        return Response.json({ message: 'Unavailable' }, { status: 503 });
      return Response.json({
        ...selected,
        result: null,
        changesApplied: 1,
        insertedRowIds: ['new-row'],
        newVersions: { 'table-1': 4 },
        statement: { kind: 'insert', tableId: 'table-1', tableName: 'Guests' },
      });
    },
    { preconnect: originalFetch.preconnect },
  );
  const macro = new Macro({ token: 'token' });
  const database = macro.databases.byId('db-1');
  expect(await database.name()).toBe('Before');
  const result = await database.query(
    "INSERT INTO Guests (Name) VALUES ('Sam')",
  );
  expect(result.insertedRows[0].id).toBe('new-row');
  expect(result.insertedRows[0].table.database).toBe(database);
  expect(result.newVersions[0].version).toBe(4);
  expect(await database.name()).toBe('After');
  await expect(
    database.query("INSERT INTO Guests (Name) VALUES ('Lee')"),
  ).rejects.toThrow();
  expect(await database.name()).toBe('After');
  expect(reads).toBe(2);
  expect(writes).toBe(2);
});

test('SQL aggregates and virtual people results do not invent database row handles', async () => {
  globalThis.fetch = Object.assign(
    async () =>
      Response.json({
        ...selected,
        tableDatabases: {},
        result: {
          columns: [{ name: 'count', kind: 'number' }],
          rows: [[{ type: 'number', value: 2 }]],
          rowIds: [],
        },
        readVersions: {},
      }),
    { preconnect: originalFetch.preconnect },
  );
  const macro = new Macro({ token: 'token' });
  const result = await macro.databases.query(
    'SELECT COUNT(*) FROM macro.people',
  );
  expect(result.result?.sourceTable).toBeUndefined();
  expect(result.result?.rowHandles).toEqual([]);
  expect(result.result?.rows).toEqual([[{ type: 'number', value: 2 }]]);
});

test('SQL writes invalidate equivalent database handles without replacing the scoped handle', async () => {
  let written = false;
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      if (request.method === 'GET')
        return Response.json({
          database: { id: 'db-1', name: written ? 'After' : 'Before' },
          tables: [],
        });
      written = true;
      return Response.json({
        ...selected,
        result: null,
        changesApplied: 1,
        newVersions: { 'table-1': 4 },
        statement: { kind: 'update', tableId: 'table-1', tableName: 'Guests' },
      });
    },
    { preconnect: originalFetch.preconnect },
  );
  const macro = new Macro({ token: 'token' });
  const scoped = macro.databases.byId('db-1');
  const other = macro.databases.byId('db-1');
  expect(await scoped.name()).toBe('Before');
  expect(await other.name()).toBe('Before');
  const result = await scoped.query('UPDATE Guests SET Name = Name', {
    baseVersions: [{ table: DatabaseTable.byId(other, 'table-1'), version: 3 }],
  });
  expect(
    result.statement.kind === 'update' && result.statement.table.database,
  ).toBe(scoped);
  expect(await scoped.name()).toBe('After');
  expect(await other.name()).toBe('After');
});

test('zero-match SQL writes return a typed target without fabricating changed versions', async () => {
  globalThis.fetch = Object.assign(
    async () =>
      Response.json({
        tableDatabases: { 'table-1': 'db-1' },
        result: null,
        changesApplied: 0,
        insertedRowIds: [],
        newVersions: {},
        readVersions: {},
        truncatedTables: [],
        statement: { kind: 'delete', tableId: 'table-1', tableName: 'Guests' },
      }),
    { preconnect: originalFetch.preconnect },
  );
  const macro = new Macro({ token: 'token' });
  const result = await macro.databases.query(
    "DELETE FROM Guests WHERE Name = 'Nobody'",
  );
  expect(result.changesApplied).toBe(0);
  expect(result.newVersions).toEqual([]);
  expect(result.statement.kind === 'delete' && result.statement.table.id).toBe(
    'table-1',
  );
});
