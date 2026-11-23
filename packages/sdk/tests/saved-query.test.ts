import { afterEach, expect, test } from 'bun:test';
import { DatabaseTable } from '../src/entities/databases/table';
import { Macro } from '../src/macro';
import { MacroApiError, MacroError } from '../src/utils';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const saved = {
  id: 'query-1',
  definition: {
    version: 1,
    query: 'SELECT "Party", COUNT(*) AS invites FROM "Guests" GROUP BY "Party"',
  },
  databaseId: 'db-1',
  createdBy: 'macro|sam@example.com',
  createdAt: '2026-11-05T00:00:00Z',
};

function serve(answer: (request: Request) => Response) {
  const requests: Request[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      requests.push(request.clone());
      return answer(request);
    },
    { preconnect: originalFetch.preconnect },
  );
  return requests;
}

const macro = () =>
  new Macro({ token: 'token', hosts: { storage: 'https://storage.test' } });

test('saveQuery saves the SQL with its chart columns and returns the live block', async () => {
  const requests = serve(() => Response.json(saved, { status: 201 }));
  const database = macro().databases.byId('db-1');

  const question = await database.saveQuery({
    sql: saved.definition.query,
    title: '  Invites per party ',
    display: {
      mode: 'bar',
      chart: { x: 'Party', y: ['invites'], title: 'Invites', stack: false },
    },
  });

  expect(requests).toHaveLength(1);
  expect(requests[0].method).toBe('POST');
  expect(new URL(requests[0].url).pathname).toBe('/databases/queries');
  expect(await requests[0].json()).toEqual({
    definition: { version: 1, query: saved.definition.query },
    databaseId: 'db-1',
    chart: { x: 'Party', y: ['invites'] },
  });
  expect(question.id).toBe('query-1');
  expect(question.database).toBe(database);
  expect(question.table).toBeUndefined();
  expect(question.title).toBe('Invites per party');
  expect(question.prompt).toBe('Invites per party');
  expect(question.toBlock()).toBe(
    '<m-db-query>{"queryId":"query-1","databaseId":"db-1","title":"Invites per party","prompt":"Invites per party","displayMode":"bar","chart":{"x":"Party","y":["invites"],"title":"Invites"}}</m-db-query>',
  );
});

test('the namespace saves a question that spans databases, with no database in the request or the block', async () => {
  const requests = serve(() =>
    Response.json({ ...saved, databaseId: null }, { status: 201 }),
  );

  const question = await macro().databases.saveQuery({
    sql: 'SELECT COUNT(*) AS rows FROM "Guests" JOIN "Tables" ON true',
    title: 'Seats',
    display: { mode: 'scalar' },
  });

  expect(requests).toHaveLength(1);
  expect(requests[0].method).toBe('POST');
  expect(new URL(requests[0].url).pathname).toBe('/databases/queries');
  expect(await requests[0].json()).toEqual({
    definition: {
      version: 1,
      query: 'SELECT COUNT(*) AS rows FROM "Guests" JOIN "Tables" ON true',
    },
  });
  expect(question.database).toBeUndefined();
  expect(question.table).toBeUndefined();
  expect(question.toBlock()).toBe(
    '<m-db-query>{"queryId":"query-1","title":"Seats","prompt":"Seats","displayMode":"scalar"}</m-db-query>',
  );
});

test('a table saves a question about itself, and the block names the table', async () => {
  serve(() => Response.json(saved, { status: 201 }));
  const guests = DatabaseTable.byId(macro().databases.byId('db-1'), 'table-1');

  const question = await guests.saveQuery({
    sql: 'SELECT COUNT(*) AS guests FROM "Guests"',
    title: 'Guests',
    prompt: 'How many guests are coming?',
    display: { mode: 'scalar' },
  });

  expect(question.table).toBe(guests);
  expect(question.toBlock()).toBe(
    '<m-db-query>{"queryId":"query-1","databaseId":"db-1","tableId":"table-1","title":"Guests","prompt":"How many guests are coming?","displayMode":"scalar"}</m-db-query>',
  );
});

test('a block escapes < so a title cannot close its tag', async () => {
  serve(() => Response.json(saved, { status: 201 }));
  const question = await macro()
    .databases.byId('db-1')
    .saveQuery({
      sql: 'SELECT 1 AS one',
      title: '</m-db-query> <b>',
      display: { mode: 'table' },
      height: 320,
    });

  const block = question.toBlock();
  expect(block.match(/<\/m-db-query>/g)).toHaveLength(1);
  expect(
    JSON.parse(block.slice('<m-db-query>'.length, -'</m-db-query>'.length)),
  ).toEqual({
    queryId: 'query-1',
    databaseId: 'db-1',
    title: '</m-db-query> <b>',
    prompt: '</m-db-query> <b>',
    displayMode: 'table',
    height: 320,
  });
});

test('an invalid presentation is refused before anything is saved', async () => {
  const requests = serve(() => Response.json(saved, { status: 201 }));
  const database = macro().databases.byId('db-1');
  const sql =
    'SELECT "Party", COUNT(*) AS invites FROM "Guests" GROUP BY "Party"';
  const refusals: [Parameters<typeof database.saveQuery>[0], string][] = [
    [
      { sql, title: ' ', display: { mode: 'table' } },
      'title must not be empty.',
    ],
    [
      // A chart mode without its chart, as plain JavaScript can pass.
      { sql, title: 'Invites', display: { mode: 'pie' } as never },
      'a pie chart needs chart columns (chart.x and chart.y).',
    ],
    [
      {
        sql,
        title: 'Invites',
        display: { mode: 'bar', chart: { x: 'Party', y: [] } },
      },
      'chart.y must name one to 5 numeric result columns.',
    ],
    [
      {
        sql,
        title: 'Invites',
        display: { mode: 'bar', chart: { x: 'Party', y: ['Party'] } },
      },
      'chart.y must not include the label column chart.x.',
    ],
    [
      {
        sql,
        title: 'Invites',
        display: {
          mode: 'bar',
          chart: { x: 'Party', y: ['invites', 'guests'], color: 'Status' },
        },
      },
      'chart.color splits a single series; with chart.color, chart.y names one column.',
    ],
    [
      { sql, title: 'Invites', display: { mode: 'donut' as never } },
      'display mode must be one of scalar, table, bar, line, area, scatter, pie; got donut',
    ],
    [
      { sql, title: 'Invites', display: { mode: 'table' }, height: 20 },
      'height must be from 96 to 1600 pixels.',
    ],
  ];
  for (const [options, message] of refusals) {
    const error = await database.saveQuery(options).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MacroError);
    expect((error as Error).message).toBe(message);
  }
  expect(requests).toHaveLength(0);
});

test('the server refusing the SQL surfaces as an API error', async () => {
  serve(() =>
    Response.json(
      { message: 'a saved query must be a SELECT; it cannot change data' },
      { status: 400 },
    ),
  );
  const error = await macro()
    .databases.byId('db-1')
    .saveQuery({
      sql: 'DELETE FROM "Guests"',
      title: 'Guests',
      display: { mode: 'table' },
    })
    .catch((e: unknown) => e);
  expect(error).toBeInstanceOf(MacroApiError);
  expect((error as MacroApiError).status).toBe(400);
});

test('withView restyles the same question and keeps it immutable', async () => {
  serve(() => Response.json(saved, { status: 201 }));
  const bar = await macro()
    .databases.byId('db-1')
    .saveQuery({
      sql: saved.definition.query,
      title: 'Invites per party',
      display: { mode: 'bar', chart: { x: 'Party', y: ['invites'] } },
    });

  const pie = bar.withView({ displayMode: 'pie', title: 'Invite share' });
  expect(pie.id).toBe(bar.id);
  expect(pie.displayMode).toBe('pie');
  expect(pie.chart).toEqual({ x: 'Party', y: ['invites'] });
  expect(pie.title).toBe('Invite share');
  expect(pie.prompt).toBe('Invites per party');
  expect(bar.displayMode).toBe('bar');
  expect(bar.title).toBe('Invites per party');

  const table = bar.withView({ displayMode: 'table', height: 400 });
  expect(table.toBlock()).toBe(
    '<m-db-query>{"queryId":"query-1","databaseId":"db-1","title":"Invites per party","prompt":"Invites per party","displayMode":"table","chart":{"x":"Party","y":["invites"]},"height":400}</m-db-query>',
  );

  expect(() => bar.withView({ displayMode: 'scalar' })).toThrow(
    'a bar answer cannot become scalar',
  );
  expect(() =>
    bar.withView({ chart: { x: 'Party', y: ['invites', 'invites'] } }),
  ).toThrow('chart.y must not name a column twice.');
});

test('a table answer without a chart cannot switch to a chart mode without one', async () => {
  serve(() => Response.json(saved, { status: 201 }));
  const rows = await macro()
    .databases.byId('db-1')
    .saveQuery({
      sql: saved.definition.query,
      title: 'Invites',
      display: { mode: 'table' },
    });

  expect(() => rows.withView({ displayMode: 'line' })).toThrow(
    'a line chart needs chart columns (chart.x and chart.y).',
  );
  expect(
    rows.withView({
      displayMode: 'line',
      chart: { x: 'Party', y: ['invites'] },
    }).displayMode,
  ).toBe('line');
});

test('sql reads the saved SELECT back from the server', async () => {
  const requests = serve((request) =>
    request.method === 'POST'
      ? Response.json(saved, { status: 201 })
      : Response.json(saved),
  );
  const question = await macro()
    .databases.byId('db-1')
    .saveQuery({
      sql: saved.definition.query,
      title: 'Invites',
      display: { mode: 'table' },
    });

  expect(await question.sql()).toBe(saved.definition.query);
  expect(requests[1].method).toBe('GET');
  expect(new URL(requests[1].url).pathname).toBe('/databases/queries/query-1');
});

test('a table from another database is refused', async () => {
  const requests = serve(() => Response.json(saved, { status: 201 }));
  const client = macro();
  const elsewhere = DatabaseTable.byId(
    client.databases.byId('db-2'),
    'table-9',
  );
  const error = await client.databases
    .byId('db-1')
    .saveQuery({
      sql: 'SELECT 1 AS one',
      title: 'One',
      display: { mode: 'table' },
      table: elsewhere,
    })
    .catch((e: unknown) => e);
  expect(error).toBeInstanceOf(MacroError);
  expect(requests).toHaveLength(0);
});
