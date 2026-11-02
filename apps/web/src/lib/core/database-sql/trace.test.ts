import { errAsync, ok, okAsync, ResultAsync } from 'neverthrow';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Catalog, Outcome } from './generated/types';
import { traceDatabaseSqlRun } from './trace';

type RecordedSpan = {
  name: string;
  attributes: Record<string, unknown>;
  children: RecordedSpan[];
  ended: boolean;
};

const recorded = vi.hoisted(() => ({
  roots: [] as RecordedSpan[],
  warnings: vi.fn(),
}));

vi.mock('@macro-inc/observability', () => {
  const fake = (node: RecordedSpan) => ({
    span: (name: string) => {
      const child = { name, attributes: {}, children: [], ended: false };
      node.children.push(child);
      return fake(child);
    },
    run: <T>(operation: () => T) => operation(),
    setAttr: (name: string, value: unknown) => {
      node.attributes[name] = value;
    },
    error: (error: unknown) => {
      node.attributes.error = error;
    },
    injectTraceHeaders: (headers: Record<string, string>) => {
      headers.traceparent = `trace-of-${node.name}`;
    },
    end: () => {
      node.ended = true;
    },
  });
  return {
    Telemetry: {
      warn: recorded.warnings,
      span: (name: string) => {
        const root = { name, attributes: {}, children: [], ended: false };
        recorded.roots.push(root);
        return fake(root);
      },
    },
  };
});

afterEach(() => {
  recorded.roots.length = 0;
  recorded.warnings.mockClear();
  vi.restoreAllMocks();
});

it('ends a cancelled read without reporting a query failure', async () => {
  await traceDatabaseSqlRun(
    { kind: 'sql', sql: 'SELECT 1' },
    { tables: [] },
    () => errAsync({ kind: 'cancelled' }),
    { reason: 'statement-change', requestPolicy: 'network-only' }
  );
  expect(recorded.roots[0].attributes['database_sql.cancelled']).toBe(true);
  expect(recorded.roots[0].attributes.error).toBeUndefined();
  expect(recorded.roots[0].ended).toBe(true);
  expect(recorded.warnings).not.toHaveBeenCalled();
});

const catalog: Catalog = {
  tables: [
    {
      id: 'guests',
      databaseId: 'party',
      database: 'Party',
      name: 'Guests',
      columns: [],
    },
  ],
};

const outcome: Outcome = {
  columns: [{ name: 'Name', column: 'name', kind: 'text' }],
  rows: [[{ type: 'text', value: 'Ada' }], [{ type: 'text', value: 'Grace' }]],
  rowIds: ['ada', 'grace'],
  readTables: ['guests'],
  truncated: false,
  insertedRowIds: [],
  changesApplied: 0,
};

describe('database SQL run traces', () => {
  it('records a run, its fetches and folds as one span tree and one console group', async () => {
    const group = vi
      .spyOn(console, 'groupCollapsed')
      .mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'groupEnd').mockImplementation(() => {});
    const headers: Record<string, string>[] = [];
    const result = await traceDatabaseSqlRun(
      { kind: 'sql', sql: 'SELECT "Name" FROM "Guests"' },
      catalog,
      (trace) =>
        trace
          .fetch(
            {
              step: 'fetch',
              id: 0,
              query: {
                type: 'soup',
                table: 'guests',
                propf: null,
                keyHint: null,
              },
              needs: ['name'],
              cursor: null,
              limit: 500,
            },
            (step) => {
              step.request('query Soup', { input: 'first' });
              headers.push(step.headers());
              return okAsync({ rows: [1] });
            },
            (page) => page.rows.length
          )
          .andThen(() => trace.fold(() => ok(undefined)))
          .andThen(() =>
            trace.fetch(
              {
                step: 'fetch',
                id: 1,
                query: {
                  type: 'soup',
                  table: 'guests',
                  propf: null,
                  keyHint: null,
                },
                needs: ['name'],
                cursor: 'next',
                limit: 500,
              },
              () => okAsync({ rows: [1] }),
              (page) => page.rows.length
            )
          )
          .map(() => outcome)
    );

    expect(result.isOk()).toBe(true);
    expect(headers).toEqual([{ traceparent: 'trace-of-database_sql.fetch' }]);
    expect(recorded.roots).toEqual([
      {
        name: 'database_sql.run',
        attributes: {
          'database_sql.fetch_count': 2,
          'database_sql.fetched_rows': 2,
          'database_sql.fetch_ms': expect.any(Number),
          'database_sql.fold_ms': expect.any(Number),
          'database_sql.statement_kind': 'sql',
          'database_sql.sql': 'SELECT "Name" FROM "Guests"',
          'database_sql.database_ids': 'party',
          'database_sql.table_ids': 'guests',
          'database_sql.row_count': 2,
          'database_sql.truncated': false,
        },
        children: [
          {
            name: 'database_sql.fetch',
            attributes: {
              'database_sql.request_kind': 'table page',
              'database_sql.table': 'guests',
              'database_sql.page': 1,
              'database_sql.hint_count': 0,
              'database_sql.rows': 1,
            },
            children: [],
            ended: true,
          },
          {
            name: 'database_sql.fold',
            attributes: {},
            children: [],
            ended: true,
          },
          {
            name: 'database_sql.fetch',
            attributes: {
              'database_sql.request_kind': 'table page',
              'database_sql.table': 'guests',
              'database_sql.page': 2,
              'database_sql.hint_count': 0,
              'database_sql.rows': 1,
            },
            children: [],
            ended: true,
          },
        ],
        ended: true,
      },
    ]);
    expect(group.mock.calls).toEqual([
      [
        expect.stringMatching(
          /^\[database-sql\] SELECT "Name" FROM "Guests" · 2 rows · 2 fetches · \d+ms$/
        ),
      ],
    ]);
  });
  it('logs failed reads with their cause and IDs without SQL or error content', async () => {
    const result = await traceDatabaseSqlRun(
      { kind: 'sql', sql: "SELECT 'private cell value' FROM Guests" },
      catalog,
      () => errAsync({ kind: 'fetch', message: 'private cell value' }),
      { reason: 'after-write', scope: 'party', requestPolicy: 'network-only' }
    );
    expect(result.isErr()).toBe(true);
    expect(recorded.roots[0].attributes).toMatchObject({
      'database_sql.read_reason': 'after-write',
      'database_sql.request_policy': 'network-only',
      'database_sql.scope_id': 'party',
    });
    expect(recorded.warnings).toHaveBeenCalledWith('database SQL read failed', {
      'database_sql.error_kind': 'fetch',
      'database_sql.read_reason': 'after-write',
      'database_sql.request_policy': 'network-only',
      'database_sql.scope_id': 'party',
      'database_sql.database_ids': 'party',
      'database_sql.table_ids': 'guests',
    });
    expect(JSON.stringify(recorded.warnings.mock.calls)).not.toContain(
      'private cell value'
    );
    expect(recorded.roots[0].ended).toBe(true);
  });

  it('keeps an expected cache warmup miss out of failure logs', async () => {
    await traceDatabaseSqlRun(
      { kind: 'sql', sql: 'SELECT Name FROM Guests' },
      catalog,
      () => errAsync({ kind: 'fetch' }),
      { reason: 'initial', requestPolicy: 'cache-only', reportFailure: false }
    );
    expect(recorded.warnings).not.toHaveBeenCalled();
    expect(recorded.roots[0].ended).toBe(true);
  });
  it('records structural engine error codes without the unknown column value', async () => {
    await traceDatabaseSqlRun(
      { kind: 'sql', sql: 'SELECT confidential FROM Guests' },
      catalog,
      () =>
        errAsync({
          kind: 'engine',
          error: {
            stage: 'view' as const,
            kind: 'unknownColumn' as const,
            column: 'confidential',
          },
        }),
      { reason: 'schema-change', requestPolicy: 'network-only' }
    );
    expect(recorded.roots[0].attributes).toMatchObject({
      'database_sql.error_stage': 'view',
      'database_sql.error_code': 'unknownColumn',
    });
    expect(JSON.stringify(recorded.warnings.mock.calls)).not.toContain(
      'confidential'
    );
  });
});

it('keeps engine and decoding phases under explicit parents across async work', async () => {
  vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'groupEnd').mockImplementation(() => {});
  await traceDatabaseSqlRun(
    { kind: 'sql', sql: 'SELECT 1' },
    catalog,
    (trace) =>
      new ResultAsync(
        (async () => {
          await trace.open(async () => 1);
          trace.start(() => 2);
          await trace.fetch(
            {
              step: 'fetch',
              id: 0,
              query: {
                type: 'soup',
                table: 'guests',
                propf: null,
                keyHint: null,
              },
              needs: [],
              cursor: null,
              limit: 500,
            },
            (step) => okAsync(step.decode(2, () => [1, 2])),
            (rows) => rows.length
          );
          return ok(outcome);
        })()
      )
  );
  expect(recorded.roots).toHaveLength(1);
  const children = recorded.roots[0].children;
  expect(children.map((span) => span.name)).toEqual([
    'database_sql.engine.open',
    'database_sql.engine.start',
    'database_sql.fetch',
  ]);
  expect(children.every((span) => span.ended)).toBe(true);
  expect(children[2].children).toEqual([
    {
      name: 'database_sql.rows.decode',
      attributes: { 'database_sql.rows': 2 },
      children: [],
      ended: true,
    },
  ]);
});
