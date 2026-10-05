import { databaseSqlSchema } from '@core/database-sql/catalog';
import type { OpenEngine } from '@core/database-sql/driver';
import type {
  Catalog,
  Page,
  Schema,
  Step,
} from '@core/database-sql/generated/types';
import * as sqlTrace from '@core/database-sql/trace';
import type { CacheHost } from '@graphql-cache/host/types';
import type {
  CacheRevision,
  EntityFilterCacheResult,
} from '@graphql-cache/protocol';
import type { SoupQuery } from '@service-storage/graphql/generated/graphql';
import {
  CombinedError,
  createClient,
  type Exchange,
  type Operation,
} from '@urql/core';
import { ok } from 'neverthrow';
import { createEffect, createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { empty, fromPromise, fromValue, mergeMap, pipe } from 'wonka';
import {
  createDatabaseSqlQuery,
  readDatabaseSql,
} from './create-database-sql-query';

const CRM = '01990000-0000-7000-8000-00000000db01';
const DEALS = '01990000-0000-7000-8000-00000000d001';
const NAME = '01990000-0000-7000-8000-00000000c001';
const NAME_COLUMN = '01990000-0000-7000-8000-00000000b001';
const ACME = '01990000-0000-7000-8000-00000000e001';
const GLOBEX = '01990000-0000-7000-8000-00000000e002';

type SoupItem = SoupQuery['user']['soup']['items'][number];

const catalog: Catalog = {
  tables: [
    {
      id: DEALS,
      databaseId: CRM,
      database: 'crm',
      name: 'deals',
      source: 'database',
      columns: [
        {
          id: NAME,
          placement: NAME_COLUMN,
          name: 'name',
          kind: { kind: 'text' },
        },
      ],
    },
  ],
};
/** What the fake builder answers `catalog` for; the builder is the engine's. */
const schema: Schema = { databases: [], platform: [] };

function deal(id: string, name: string, createdAt: string): SoupItem {
  return {
    __typename: 'GraphqlSoupDatabaseRow',
    id,
    tableId: DEALS,
    databaseId: 'db000000-0000-0000-0000-000000000001',
    position: 'a',
    ownerId: 'macro|owner@databases.test',
    creatorId: null,
    createdAt,
    updatedAt: createdAt,
    cacheProjection: null,
    frecencyScore: null,
    entityType: 'DATABASE_ROW',
    displayName: null,
    isFavorited: false,
    notifications: [],
    properties: [
      {
        id: `${id}-name`,
        propertyDefinitionId: NAME,
        displayName: 'name',
        dataType: 'STRING',
        isMultiSelect: false,
        specificEntityType: null,
        isSystem: false,
        isMetadata: false,
        value: { __typename: 'GraphqlStringPropertyValue', stringValue: name },
      },
    ],
  };
}

const acme = deal(ACME, 'Acme', '2026-01-01T00:00:00Z');
const globex = deal(GLOBEX, 'Globex', '2026-01-02T00:00:00Z');

/** `SELECT name FROM crm.deals`, answered with the names fed, in order. */
const names: OpenEngine = async () => {
  const fetch: Step = {
    step: 'fetch',
    id: 0,
    query: { type: 'soup', table: DEALS, propf: null, keyHint: null },
    needs: [NAME],
    cursor: null,
    limit: 500,
  };
  const done = (page: Page): Step => ({
    step: 'done',
    columns: [{ name: 'name', column: NAME, kind: 'text' }],
    rows: page.rows.map((row) => [row.cells[NAME] ?? null]),
    rowIds: page.rows.map((row) => row.id),
    readTables: [DEALS],
    truncated: false,
    insertedRowIds: [],
    changesApplied: 0,
  });
  return {
    start: () => fetch,
    feed_page: (_id, page) => done(page),
    feed_bins: () => {
      throw 'no bins';
    },
    free: () => {},
  };
};

let dispose: (() => void) | undefined;

beforeEach(() => {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.restoreAllMocks();
});

describe('createDatabaseSqlQuery', () => {
  it.each([true, false])(
    'answers before the network only when cached rows exist (%s)',
    async (cacheHit) => {
      let finishNetwork: (() => void) | undefined;
      const policies: string[] = [];
      const loadingStates: boolean[] = [];
      const exchange: Exchange = () => (incoming) =>
        pipe(
          incoming,
          mergeMap((operation) => {
            if (operation.kind === 'teardown') return empty;
            const policy = operation.context.requestPolicy;
            policies.push(policy);
            const response = {
              operation,
              data: {
                user: {
                  id: 'macro|viewer@databases.test',
                  emailLinks: [],
                  soup: {
                    items: policy === 'cache-only' ? [acme] : [globex],
                    nextCursor: null,
                  },
                },
              } satisfies SoupQuery,
              stale: false,
              hasNext: false,
            };
            if (policy === 'cache-only')
              return fromValue(
                cacheHit ? response : { ...response, data: undefined }
              );
            return fromPromise(
              new Promise<typeof response>((resolve) => {
                finishNetwork = () => resolve(response);
              })
            );
          })
        );
      const client = createClient({
        url: 'http://test.invalid/graphql',
        exchanges: [exchange],
      });
      const query = createRoot((cleanup) => {
        dispose = cleanup;
        const query = createDatabaseSqlQuery(
          () => ({ schema, sql: 'SELECT name FROM crm.deals' }),
          {
            client: () => client,
            cacheHost: () => ({
              onCacheChanged: () => () => {},
              entityFilter: vi.fn(),
              readRecordsByKeys: vi.fn(),
            }),
            people: async () => [],
            catalog: async () => catalog,
            open: names,
          }
        );
        createEffect(() => loadingStates.push(query.loading()));
        return query;
      });
      await vi.waitFor(() => expect(finishNetwork).toBeDefined());
      if (cacheHit)
        expect(query.outcome()?.rows).toEqual([
          [{ type: 'text', value: 'Acme' }],
        ]);
      else expect(query.outcome()).toBeUndefined();
      expect(query.error()).toBeUndefined();
      expect(query.loading()).toBe(true);
      expect(policies).toEqual(['cache-only', 'network-only']);
      expect(loadingStates).toEqual([true]);
      finishNetwork?.();
      await vi.waitFor(() =>
        expect(query.outcome()?.rows).toEqual([
          [{ type: 'text', value: 'Globex' }],
        ])
      );
      expect(query.loading()).toBe(false);
      expect(loadingStates).toEqual([true, false]);
    }
  );

  it('shows a row the cache learns about without reading the network again', async () => {
    const requests: Operation[] = [];
    const exchange: Exchange = () => (incoming) =>
      pipe(
        incoming,
        mergeMap((operation) => {
          if (operation.kind === 'teardown') return empty;
          requests.push(operation);
          const data: SoupQuery = {
            user: {
              id: 'macro|viewer@databases.test',
              emailLinks: [],
              soup: { items: [acme], nextCursor: null },
            },
          };
          return fromValue({ operation, data, stale: false, hasNext: false });
        })
      );
    const client = createClient({
      url: 'http://test.invalid/graphql',
      exchanges: [exchange],
    });
    const revision = 'revision-2' as CacheRevision;
    let cacheChanged = (_revision: CacheRevision) => {};
    const reconciled: EntityFilterCacheResult = {
      kind: 'reconciled',
      revision,
      keys: [
        `GraphqlSoupDatabaseRow:${GLOBEX}`,
        `GraphqlSoupDatabaseRow:${ACME}`,
      ],
      retainedKeys: [],
      optimistic: false,
    };
    const entityFilter = vi.fn<CacheHost['entityFilter']>(
      async () => reconciled
    );
    const host = {
      onCacheChanged: (callback: (revision: CacheRevision) => void) => {
        cacheChanged = callback;
        return () => {};
      },
      entityFilter,
      readRecordsByKeys: async () => ({
        revision,
        records: [
          { recordKey: `GraphqlSoupDatabaseRow:${GLOBEX}`, record: globex },
          { recordKey: `GraphqlSoupDatabaseRow:${ACME}`, record: acme },
        ],
      }),
    } satisfies Pick<
      CacheHost,
      'onCacheChanged' | 'entityFilter' | 'readRecordsByKeys'
    >;

    const query = createRoot((cleanup) => {
      dispose = cleanup;
      return createDatabaseSqlQuery(
        () => ({ schema, sql: 'SELECT name FROM crm.deals' }),
        {
          client: () => client,
          cacheHost: () => host,
          people: async () => [],
          catalog: async () => catalog,
          open: names,
        }
      );
    });

    await vi.waitFor(() =>
      expect(query.outcome()?.rows).toEqual([[{ type: 'text', value: 'Acme' }]])
    );
    expect(
      requests.map((operation) => operation.context.requestPolicy)
    ).toEqual(['cache-only', 'network-only']);

    cacheChanged(revision);

    await vi.waitFor(() =>
      expect(query.outcome()?.rows).toEqual([
        [{ type: 'text', value: 'Globex' }],
        [{ type: 'text', value: 'Acme' }],
      ])
    );
    expect(requests).toHaveLength(2);
    expect(entityFilter).toHaveBeenCalledWith({
      filters: requests[0]?.variables?.input.initial.filters,
      sortMethod: 'CREATED_AT',
      sortDirection: 'DESC',
      limit: 500,
      baseline: [
        {
          key: `GraphqlSoupDatabaseRow:${ACME}`,
          sortTimestamp: '2026-01-01T00:00:00Z',
        },
      ],
    });
  });

  it('keeps the last answer on screen while a changed statement runs', async () => {
    let release = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const answered = (sql: string): Step => ({
      step: 'done',
      columns: [{ name: 'name', column: NAME, kind: 'text' }],
      rows: [[{ type: 'text', value: sql }]],
      rowIds: [ACME],
      readTables: [DEALS],
      truncated: false,
      insertedRowIds: [],
      changesApplied: 0,
    });
    const open: OpenEngine = async (_catalog, sql) => {
      if (sql.includes('WHERE')) await released;
      return {
        start: () => answered(sql),
        feed_page: () => answered(sql),
        feed_bins: () => answered(sql),
        free: () => {},
      };
    };
    const [sql, setSql] = createSignal('SELECT name FROM crm.deals');
    const query = createRoot((cleanup) => {
      dispose = cleanup;
      return createDatabaseSqlQuery(() => ({ schema, sql: sql() }), {
        client: () =>
          createClient({ url: 'http://test.invalid', exchanges: [] }),
        cacheHost: () => undefined,
        people: async () => [],
        catalog: async () => catalog,
        open,
      });
    });
    await vi.waitFor(() =>
      expect(query.outcome()?.rows).toEqual([
        [{ type: 'text', value: 'SELECT name FROM crm.deals' }],
      ])
    );

    setSql("SELECT name FROM crm.deals WHERE name = 'Acme'");

    expect(query.loading()).toBe(true);
    expect(query.outcome()?.rows).toEqual([
      [{ type: 'text', value: 'SELECT name FROM crm.deals' }],
    ]);
    release();
    await vi.waitFor(() =>
      expect(query.outcome()?.rows).toEqual([
        [
          {
            type: 'text',
            value: "SELECT name FROM crm.deals WHERE name = 'Acme'",
          },
        ],
      ])
    );
  });

  it('refreshes from the network, and a failed refresh fails as a fetch and keeps the answer', async () => {
    const traced = vi.spyOn(sqlTrace, 'traceDatabaseSqlRun');
    const policies: string[] = [];
    let failing = false;
    const exchange: Exchange = () => (incoming) =>
      pipe(
        incoming,
        mergeMap((operation) => {
          if (operation.kind === 'teardown') return empty;
          policies.push(operation.context.requestPolicy);
          if (failing)
            return fromValue({
              operation,
              error: new CombinedError({ networkError: new Error('offline') }),
              stale: false,
              hasNext: false,
            });
          const data: SoupQuery = {
            user: {
              id: 'macro|viewer@databases.test',
              emailLinks: [],
              soup: { items: [acme], nextCursor: null },
            },
          };
          return fromValue({ operation, data, stale: false, hasNext: false });
        })
      );
    const client = createClient({
      url: 'http://test.invalid/graphql',
      exchanges: [exchange],
    });
    const query = createRoot((cleanup) => {
      dispose = cleanup;
      return createDatabaseSqlQuery(
        () => ({ schema, sql: 'SELECT name FROM crm.deals' }),
        {
          client: () => client,
          cacheHost: () => undefined,
          people: async () => [],
          catalog: async () => catalog,
          open: names,
        }
      );
    });
    await vi.waitFor(() =>
      expect(query.outcome()?.rows).toEqual([[{ type: 'text', value: 'Acme' }]])
    );

    expect(await query.refresh('after-write')).toEqual(ok({ landed: true }));
    failing = true;
    expect((await query.refresh('after-write'))._unsafeUnwrapErr()).toEqual({
      kind: 'fetch',
      message: '[Network] offline',
    });

    expect(policies).toEqual([
      'cache-and-network',
      'network-only',
      'network-only',
    ]);
    expect(query.error()).toEqual({
      kind: 'fetch',
      message: '[Network] offline',
    });
    expect(query.outcome()?.rows).toEqual([[{ type: 'text', value: 'Acme' }]]);
    expect(traced.mock.calls.map((call) => call[3]?.reason)).toEqual([
      'initial',
      'after-write',
      'after-write',
    ]);
  });

  it('keeps a refresh from the network when the cache changes while it is in flight', async () => {
    let answerRefresh = (_items: SoupItem[]) => {};
    let refreshing = false;
    const exchange: Exchange = () => (incoming) =>
      pipe(
        incoming,
        mergeMap((operation) => {
          if (operation.kind === 'teardown') return empty;
          const respond = (items: SoupItem[]) => {
            const data: SoupQuery = {
              user: {
                id: 'macro|viewer@databases.test',
                emailLinks: [],
                soup: { items, nextCursor: null },
              },
            };
            return { operation, data, stale: false, hasNext: false };
          };
          if (!refreshing) return fromValue(respond([acme]));
          return fromPromise(
            new Promise<ReturnType<typeof respond>>((resolve) => {
              answerRefresh = (items) => resolve(respond(items));
            })
          );
        })
      );
    const client = createClient({
      url: 'http://test.invalid/graphql',
      exchanges: [exchange],
    });
    const revision = 'revision-2' as CacheRevision;
    let cacheChanged = (_revision: CacheRevision) => {};
    // The cache has not heard of the refreshed rows yet.
    const host = {
      onCacheChanged: (callback: (revision: CacheRevision) => void) => {
        cacheChanged = callback;
        return () => {};
      },
      entityFilter: async (): Promise<EntityFilterCacheResult> => ({
        kind: 'reconciled',
        revision,
        keys: [`GraphqlSoupDatabaseRow:${ACME}`],
        retainedKeys: [],
        optimistic: false,
      }),
      readRecordsByKeys: async () => ({
        revision,
        records: [
          { recordKey: `GraphqlSoupDatabaseRow:${ACME}`, record: acme },
        ],
      }),
    } satisfies Pick<
      CacheHost,
      'onCacheChanged' | 'entityFilter' | 'readRecordsByKeys'
    >;
    const query = createRoot((cleanup) => {
      dispose = cleanup;
      return createDatabaseSqlQuery(
        () => ({ schema, sql: 'SELECT name FROM crm.deals' }),
        {
          client: () => client,
          cacheHost: () => host,
          people: async () => [],
          catalog: async () => catalog,
          open: names,
        }
      );
    });
    await vi.waitFor(() =>
      expect(query.outcome()?.rows).toEqual([[{ type: 'text', value: 'Acme' }]])
    );

    refreshing = true;
    const refreshed = query.refresh();
    cacheChanged(revision);
    await new Promise((resolve) => setTimeout(resolve, 0));
    answerRefresh([globex]);
    await refreshed;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(query.outcome()?.rows).toEqual([
      [{ type: 'text', value: 'Globex' }],
    ]);
  });
});

describe('a refresh another run replaced', () => {
  it('resolves as not landed when the statement changes while it is in flight', async () => {
    let answerRefresh: (() => void) | undefined;
    const exchange: Exchange = () => (incoming) =>
      pipe(
        incoming,
        mergeMap((operation) => {
          if (operation.kind === 'teardown') return empty;
          const response = {
            operation,
            data: {
              user: {
                id: 'macro|viewer@databases.test',
                emailLinks: [],
                soup: { items: [acme], nextCursor: null },
              },
            } satisfies SoupQuery,
            stale: false,
            hasNext: false,
          };
          if (operation.context.requestPolicy !== 'network-only')
            return fromValue(response);
          return fromPromise(
            new Promise<typeof response>((resolve) => {
              answerRefresh = () => resolve(response);
            })
          );
        })
      );
    const client = createClient({
      url: 'http://test.invalid/graphql',
      exchanges: [exchange],
    });
    const [sql, setSql] = createSignal('SELECT name FROM crm.deals');
    const query = createRoot((cleanup) => {
      dispose = cleanup;
      return createDatabaseSqlQuery(() => ({ schema, sql: sql() }), {
        client: () => client,
        cacheHost: () => undefined,
        people: async () => [],
        catalog: async () => catalog,
        open: names,
      });
    });
    await vi.waitFor(() =>
      expect(query.outcome()?.rows).toEqual([[{ type: 'text', value: 'Acme' }]])
    );

    const refreshed = query.refresh();
    setSql("SELECT name FROM crm.deals WHERE name = 'Acme'");
    await vi.waitFor(() => expect(answerRefresh).toBeDefined());
    answerRefresh?.();

    expect(await refreshed).toEqual(ok({ landed: false }));
  });
});

describe('readDatabaseSql over macro.people', () => {
  it('reads the people a viewer can see with no databases open', async () => {
    const PEOPLE = '01990000-0000-7000-8000-00000000a001';
    const PERSON_ID = '01990000-0000-7000-8000-00000000a002';
    const PERSON_NAME = '01990000-0000-7000-8000-00000000a003';
    const PERSON_EMAIL = '01990000-0000-7000-8000-00000000a004';
    const peopleCatalog: Catalog = {
      tables: [
        {
          id: PEOPLE,
          databaseId: PEOPLE,
          database: 'macro',
          name: 'people',
          source: 'people',
          columns: [
            {
              id: PERSON_ID,
              placement: PERSON_ID,
              name: 'id',
              kind: { kind: 'entity', multi: false, target: 'USER' },
            },
            {
              id: PERSON_NAME,
              placement: PERSON_NAME,
              name: 'name',
              kind: { kind: 'text' },
            },
            {
              id: PERSON_EMAIL,
              placement: PERSON_EMAIL,
              name: 'email',
              kind: { kind: 'text' },
            },
          ],
        },
      ],
    };
    // Stands in for the engine's builder: `macro.people` exists only when
    // the schema offers it.
    const catalogOf = async (built: Schema): Promise<Catalog> =>
      built.platform?.includes('people') ? peopleCatalog : { tables: [] };
    const peopleNames: OpenEngine = async (opened) => {
      if (!opened.tables.some((table) => table.source === 'people'))
        throw new Error('unknown table macro.people');
      return {
        start: () => ({
          step: 'fetch',
          id: 0,
          query: { type: 'people', ids: null },
          needs: [PERSON_NAME],
          cursor: null,
          limit: 500,
        }),
        feed_page: (_id, page) => ({
          step: 'done',
          columns: [{ name: 'name', column: PERSON_NAME, kind: 'text' }],
          rows: page.rows.map((row) => [row.cells[PERSON_NAME] ?? null]),
          rowIds: page.rows.map((row) => row.id),
          readTables: [PEOPLE],
          truncated: false,
          insertedRowIds: [],
          changesApplied: 0,
        }),
        feed_bins: () => {
          throw 'no bins';
        },
        free: () => {},
      };
    };

    const read = await readDatabaseSql(
      { schema: databaseSqlSchema([]), sql: 'SELECT name FROM macro.people' },
      {
        client: () => createClient({ url: 'http://test', exchanges: [] }),
        cacheHost: () => undefined,
        people: async () => [
          {
            id: 'macro|ada@databases.test',
            name: 'Ada',
            email: 'ada@databases.test',
          },
        ],
        catalog: catalogOf,
        open: peopleNames,
      }
    );

    expect(read._unsafeUnwrap().outcome.rows).toEqual([
      [{ type: 'text', value: 'Ada' }],
    ]);
  });
});
