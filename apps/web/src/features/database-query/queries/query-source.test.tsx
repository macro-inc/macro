import type {
  Catalog,
  Outcome,
  Schema,
} from '@core/database-sql/generated/types';
import type { DatabaseSqlQueryCapabilities } from '@queries/database-sql/create-database-sql-query';
import { databaseCompletionRequest } from '@service-cognition/database-query-prompt';
import type { DatabaseDetail } from '@service-storage/generated/schemas/databaseDetail';
import type { SoupQuery } from '@service-storage/graphql/generated/graphql';
import { CombinedError, createClient, type Exchange } from '@urql/core';
import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { empty, fromValue, mergeMap, pipe } from 'wonka';
import { type QueryFailure, queryFocusTable } from '../core/query';
import {
  createLiveQuerySource,
  type LiveQuerySource,
  toQuerySchema,
} from './query-source';

afterEach(() => vi.useRealTimers());
describe('query schema', () => {
  it('carries the pre-quoted SQL names and relation metadata into the prompt', () => {
    const detail: DatabaseDetail = {
      database: {
        id: 'db',
        name: 'Renamed database',
        owner_id: 'owner',
        created_at: '',
        trashed_at: null,
      },
      grant: 'owner',
      tables: [
        {
          views: [],
          table: {
            id: 'legacy',
            database_id: 'db',
            name: 'Projects',
            position: 'a',
            version: 1,
          },
          sql_name: '"Projects"',
          columns: [],
        },
        {
          views: [],
          table: {
            id: 'contacts',
            database_id: 'db',
            name: 'Contacts',
            position: 'b',
            version: 1,
          },
          sql_name: '"Contacts"',
          columns: [],
        },
      ],
    };
    detail.tables[1].columns.push({
      shared_outside_database: false,
      column: {
        id: 'relation-column',
        table_id: 'contacts',
        property_definition_id: 'relation-definition',
        position: 'a',
        config: { kind: 'link', database_id: 'db', table_id: 'legacy' },
        display_name: null,
        infer_type: false,
      },
      sql_name: '"Projects"',
      writable: false,
      definition: {
        definition: {
          id: 'relation-definition',
          owner: { scope: 'database', database_id: 'db' },
          display_name: 'Projects',
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
    const schema = toQuerySchema(detail, 'contacts');
    expect(queryFocusTable(schema)?.name).toBe('Contacts');
    expect(queryFocusTable(schema)?.sqlName).toBe('"Contacts"');
    expect(schema.tables[0].sqlName).toBe('"Projects"');
    expect(schema.tables.map((table) => table.sqlName)).toEqual([
      '"Projects"',
      '"Contacts"',
      'macro.people',
    ]);
    expect(schema.tables[1].columns[0]).toMatchObject({
      multiple: true,
      relation: {
        databaseId: 'db',
        tableId: 'legacy',
        writable: false,
      },
    });
    const request = databaseCompletionRequest({
      prompt: 'Show contacts and their projects',
      sql: '',
      schema,
    });
    expect(
      JSON.parse(request.prompt).schema.tables[1].columns[0].relation
    ).toEqual(schema.tables[1].columns[0].relation);
    expect(request.additional_instructions).toContain(
      'registered QueryDatabase tool reference'
    );
    expect(request.additional_instructions).toContain(
      'sqlName values are those names already quoted for SQL'
    );
    expect(request.additional_instructions).not.toMatch(
      /json_each|strftime|junction|readSqlName|SQLite/
    );
  });
});

/** The catalog the engine builds of `workspace` and `personal`. */
const catalog: Catalog = {
  tables: [
    {
      id: 'projects-table',
      databaseId: 'db-work',
      database: 'Work',
      name: 'Projects',
      source: 'database',
      columns: [],
    },
    {
      id: 'projects-personal',
      databaseId: 'db-personal',
      database: 'Personal',
      name: 'Projects',
      source: 'database',
      columns: [],
    },
  ],
};

/** The engine's answer to any statement, after one Soup page, noting each run. */
function engine(count: () => number, offline: () => boolean = () => false) {
  const runs: string[] = [];
  const builds: { schema: Schema; scope?: string }[] = [];
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
  const read: DatabaseSqlQueryCapabilities = {
    client: () => client,
    cacheHost: () => undefined,
    people: async () => [],
    catalog: async (schema, scope) => {
      builds.push({ schema, scope });
      return catalog;
    },
    open: async (_catalog, sql) => {
      runs.push(sql);
      const answer: Outcome = {
        columns: [{ name: 'COUNT(*)', kind: 'number' }],
        rows: [[{ type: 'number', value: count() }]],
        rowIds: [],
        readTables: ['projects-table'],
        truncated: false,
        insertedRowIds: [],
        changesApplied: 0,
      };
      return {
        start: () => ({
          step: 'fetch',
          id: 0,
          query: {
            type: 'soup',
            table: 'projects-table',
            propf: null,
            keyHint: null,
          },
          needs: [],
          cursor: null,
          limit: 500,
        }),
        feed_page: () => ({ step: 'done', ...answer }),
        feed_bins: () => {
          throw 'no bins';
        },
        free: () => {},
      };
    },
  };
  return { read, runs, builds };
}

const workspace: DatabaseDetail = {
  database: {
    id: 'db-work',
    name: 'Work',
    owner_id: 'owner',
    created_at: '',
    trashed_at: null,
  },
  grant: 'edit',
  tables: [
    {
      views: [],
      table: {
        id: 'projects-table',
        database_id: 'db-work',
        name: 'Projects',
        position: 'a',
        version: 3,
      },
      sql_name: '"Work"."Projects"',
      columns: [],
    },
  ],
};
const personal: DatabaseDetail = {
  ...workspace,
  database: { ...workspace.database, id: 'db-personal', name: 'Personal' },
  tables: [
    {
      ...workspace.tables[0],
      table: {
        ...workspace.tables[0].table,
        id: 'projects-personal',
        database_id: 'db-personal',
      },
      sql_name: '"Personal"."Projects"',
    },
  ],
};

describe('live query source', () => {
  it('answers a saved query in the browser over every database the viewer can reach, as the exec API would', async () => {
    const { read, runs, builds } = engine(() => 2);
    let source!: LiveQuerySource;
    const dispose = createRoot((dispose) => {
      source = createLiveQuerySource({
        statement: () => ({
          sql: 'SELECT COUNT(*) FROM Projects',
          databaseId: 'db-work',
        }),
        databases: () => [workspace, personal],
        loadError: () => undefined,
        subscribe: () => {},
        read,
      });
      return dispose;
    });
    await vi.waitFor(() =>
      expect(source.answer()).toEqual({
        columns: [{ name: 'COUNT(*)', kind: 'number' }],
        rows: [[{ type: 'number', value: 2 }]],
        rowIds: [],
        readTables: ['projects-table'],
        readDatabaseIds: ['db-work'],
        truncatedTables: [],
      })
    );
    expect(runs).toEqual(['SELECT COUNT(*) FROM Projects']);
    expect(builds).toEqual([
      {
        scope: 'db-work',
        schema: {
          databases: [
            {
              id: 'db-work',
              name: 'Work',
              tables: [{ id: 'projects-table', name: 'Projects', columns: [] }],
            },
            {
              id: 'db-personal',
              name: 'Personal',
              tables: [
                { id: 'projects-personal', name: 'Projects', columns: [] },
              ],
            },
          ],
          platform: ['people'],
        },
      },
    ]);
    expect(source.loading()).toBe(false);
    dispose();
  });

  it('reruns once changes to a table it read settle, recovers from a failed rerun, and stops on dispose', async () => {
    let count = 2;
    let offline = false;
    const { read, runs } = engine(
      () => count,
      () => offline
    );
    let emit!: (tableId: string) => void;
    let source!: LiveQuerySource;
    const dispose = createRoot((dispose) => {
      source = createLiveQuerySource({
        statement: () => ({ sql: 'SELECT COUNT(*) FROM Projects' }),
        databases: () => [workspace],
        loadError: () => undefined,
        subscribe: (onChange) => {
          emit = onChange;
        },
        read,
      });
      return dispose;
    });
    await vi.waitFor(() =>
      expect(source.answer()?.rows).toEqual([[{ type: 'number', value: 2 }]])
    );

    vi.useFakeTimers();
    emit('another-table');
    await vi.advanceTimersByTimeAsync(350);
    expect(runs).toHaveLength(1);

    offline = true;
    emit('projects-table');
    emit('projects-table');
    await vi.advanceTimersByTimeAsync(299);
    expect(runs).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() =>
      expect(source.error()).toMatchObject({ kind: 'fetch' })
    );
    expect(runs).toHaveLength(2);
    expect(source.answer()?.rows).toEqual([[{ type: 'number', value: 2 }]]);

    offline = false;
    count = 3;
    emit('projects-table');
    await vi.advanceTimersByTimeAsync(300);
    await vi.waitFor(() =>
      expect(source.answer()?.rows).toEqual([[{ type: 'number', value: 3 }]])
    );
    expect(source.error()).toBeUndefined();

    emit('projects-table');
    dispose();
    await vi.advanceTimersByTimeAsync(500);
    expect(runs).toHaveLength(3);
  });

  it('reports why the saved query or the databases could not load', () => {
    const failure: QueryFailure = {
      kind: 'question',
      error: {
        code: 'NOT_FOUND',
        message: 'This saved question no longer exists.',
      },
    };
    const dispose = createRoot((dispose) => {
      const source = createLiveQuerySource({
        statement: () => undefined,
        databases: () => undefined,
        loadError: () => failure,
        subscribe: () => {},
        read: engine(() => 0).read,
      });
      expect(source.error()).toBe(failure);
      expect(source.loading()).toBe(false);
      expect(source.answer()).toBeUndefined();
      return dispose;
    });
    dispose();
  });
});
