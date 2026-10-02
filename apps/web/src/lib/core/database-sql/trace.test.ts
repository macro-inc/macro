import { ok, okAsync } from 'neverthrow';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Catalog, Outcome } from './generated/types';
import { traceDatabaseSqlRun } from './trace';

type RecordedSpan = {
  name: string;
  attributes: Record<string, unknown>;
  children: RecordedSpan[];
  ended: boolean;
};

const recorded = vi.hoisted(() => ({ roots: [] as RecordedSpan[] }));

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
  vi.restoreAllMocks();
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
});
