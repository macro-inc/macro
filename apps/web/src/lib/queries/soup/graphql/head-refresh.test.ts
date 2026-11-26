import type {
  Client,
  CombinedError,
  GraphQLRequest,
  Operation,
  OperationContext,
  OperationResult,
} from '@urql/core';
import type { DocumentNode } from 'graphql';
import { createComputed, createRoot, createSignal } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fromValue, makeSubject } from 'wonka';

const getGraphqlSoupClientMock = vi.hoisted(() => vi.fn());
const getGraphqlSoupCacheHostMock = vi.hoisted(() => vi.fn());
const entityFilterMock = vi.hoisted(() => vi.fn());
const readRecordsByKeysMock = vi.hoisted(() => vi.fn());
const makeGraphqlSoupInputMock = vi.hoisted(() => vi.fn());
const REVISION_1 = '1';

vi.mock('../../../graphql-cache/exchange/record-selection', () => ({
  selectRecords: vi.fn((document) => ({ document })),
  readRecordsByKeys: readRecordsByKeysMock,
}));
vi.mock('../../../graphql-cache/exchange/normalized-cache-exchange', () => ({
  normalizedCacheResultMetadata: (result: OperationResult) =>
    result.extensions?.__macroNormalizedCache,
}));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: getGraphqlSoupClientMock,
  getGraphqlSoupCacheHost: getGraphqlSoupCacheHostMock,
  hasGraphqlCacheHost: () => getGraphqlSoupCacheHostMock() !== undefined,
  graphqlSoupProjectionSupported: () => true,
  mapGraphqlSoupItem: (item: unknown) => item,
}));
vi.mock('./ast', () => ({ makeGraphqlSoupInput: makeGraphqlSoupInputMock }));
vi.mock('../transform-utils', () => ({
  mapApiSoupItemToEntity: (item: unknown) => item,
}));
vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return { queryClient: new QueryClient() };
});

import { queryClient } from '@queries/client';
import { createSoupLiveQuery } from './create-soup-live-query';

type FakeExecution = {
  document: DocumentNode;
  context: Partial<OperationContext>;
  variables: Record<string, unknown>;
  fail(error: CombinedError): void;
  next(
    data: unknown,
    metadata?: {
      source: 'live-network' | 'normalized-cache-hit' | 'affected-cache-reread';
      revision?: string;
      persistence?: Promise<string | undefined>;
    },
    error?: CombinedError
  ): void;
};

type SoupPageFixture = {
  items: unknown[];
  next_cursor: string | null;
};

function graphqlSoupPage(page: SoupPageFixture) {
  return {
    user: {
      soup: {
        items: page.items.map((item) => ({
          __typename: 'GraphqlSoupDocument',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          ...(item as object),
        })),
        nextCursor: page.next_cursor,
      },
    },
  };
}

function makeFakeClient(onExecution?: (count: number) => void): {
  client: Client;
  executions: FakeExecution[];
} {
  const executions: FakeExecution[] = [];
  const execute = (
    _request: GraphQLRequest<unknown, Record<string, unknown>>,
    context: Partial<OperationContext>
  ) => {
    const subject =
      makeSubject<OperationResult<unknown, Record<string, unknown>>>();
    const operation = {
      kind: 'query',
      context,
    } as Operation<unknown, Record<string, unknown>>;
    executions.push({
      document: _request.query,
      context,
      variables: _request.variables,
      fail: (error) =>
        subject.next({ operation, error, stale: false, hasNext: false }),
      next: (
        data,
        metadata = { source: 'live-network', revision: REVISION_1 },
        error
      ) =>
        subject.next({
          operation,
          data,
          error,
          extensions: { __macroNormalizedCache: metadata },
          stale: false,
          hasNext: false,
        } as OperationResult<unknown, Record<string, unknown>>),
    });
    onExecution?.(executions.length);
    return subject.source;
  };

  return {
    executions,
    client: {
      executeQuery: execute,
    } as unknown as Client,
  };
}

describe('automatic Soup revalidation', () => {
  beforeEach(() => {
    queryClient.clear();
    vi.clearAllMocks();
    getGraphqlSoupCacheHostMock.mockReturnValue(undefined);
    makeGraphqlSoupInputMock.mockReturnValue({
      initial: { limit: 50, sortMethod: 'UPDATED_AT' },
    });
  });
  it('rejects a nonchronological head read instead of sorting it as a time range', async () => {
    const fake = makeFakeClient();
    getGraphqlSoupClientMock.mockReturnValue(fake.client);
    const { source, dispose } = createRoot((dispose) => ({
      source: createSoupLiveQuery(() => ({ sortMethod: 'NAME', limit: 2 })),
      dispose,
    }));
    try {
      fake.executions[0].next(
        graphqlSoupPage({ items: [], next_cursor: null })
      );
      const head = source.refreshHead();
      fake.executions[1]?.next(
        graphqlSoupPage({ items: [], next_cursor: null })
      );
      await expect(head).rejects.toThrow('chronological');
    } finally {
      dispose();
    }
  });

  it.each([false, true])(
    'keeps a deep cursor row when rebuilding a gap (old thread replied: %s)',
    async (replied) => {
      const fourth = Promise.withResolvers<void>();
      const fifth = Promise.withResolvers<void>();
      const fake = makeFakeClient((count) => {
        if (count === 4) fourth.resolve();
        if (count === 5) fifth.resolve();
      });
      getGraphqlSoupClientMock.mockReturnValue(fake.client);
      const record = (id: string, time: number) => ({
        __typename: 'GraphqlSoupDocument',
        id,
        name: id,
        updatedAt: new Date(time * 1000).toISOString(),
      });
      const old = Array.from({ length: 250 }, (_, index) =>
        record(`old-${index}`, 250 - index)
      );
      const fresh = [
        record('new-head', 1000),
        record(replied ? 'old-249' : 'new-edge', 999),
      ];
      const records = new Map(
        [...old, ...fresh].map((row) => [`GraphqlSoupDocument:${row.id}`, row])
      );
      getGraphqlSoupCacheHostMock.mockReturnValue({
        liveQueries: true,
        currentRevision: async () => REVISION_1,
        entityFilter: entityFilterMock,
        onCacheChanged: () => () => {},
        onCacheGenerationChanged: () => () => {},
      });
      entityFilterMock.mockImplementation(async ({ baseline, liveQuery }) =>
        liveQuery?.release
          ? { kind: 'unsupported' }
          : {
              kind: 'live-query',
              revision: REVISION_1,
              reset: true,
              keys: baseline.map((row: { key: string }) => row.key),
              upserts: baseline.flatMap((row: { key: string }) => {
                const record = records.get(row.key);
                return record ? [{ recordKey: row.key, record }] : [];
              }),
              patches: [],
              removed: [],
              retainedKeys: [],
              optimistic: false,
            }
      );
      const ready = Promise.withResolvers<void>();
      const { source, dispose } = createRoot((dispose) => {
        const source = createSoupLiveQuery(() => ({
          filters: {},
          sortMethod: 'UPDATED_AT',
          limit: 2,
        }));
        createComputed(() => {
          if (source.cacheMaintained()) ready.resolve();
        });
        return { source, dispose };
      });
      try {
        fake.executions[0].next(
          graphqlSoupPage({ items: old.slice(0, 2), next_cursor: 'old-tail' })
        );
        const tail = source.fetchNextPage();
        fake.executions[1].next(
          graphqlSoupPage({ items: old.slice(2), next_cursor: 'old-next' })
        );
        await tail;
        await ready.promise;
        const head = source.refreshHead();
        fake.executions[2].next(
          graphqlSoupPage({ items: fresh, next_cursor: 'new-tail' })
        );
        await Promise.race([fourth.promise, head]);
        expect(fake.executions).toHaveLength(4);
        const cursorId = old[249].id;
        expect(source.data()?.some((row) => row.id === cursorId)).toBe(true);
        expect(source.data()?.length).toBeGreaterThanOrEqual(250);
        await fourth.promise;
        fake.executions[3].next(
          graphqlSoupPage({ items: fresh, next_cursor: 'new-tail' })
        );
        await fifth.promise;
        expect(fake.executions[4].variables).toMatchObject({
          input: { continuation: { cursor: 'new-tail' } },
        });
        fake.executions[4].next(
          graphqlSoupPage({ items: old, next_cursor: null })
        );
        await head;
        expect(source.data()?.some((row) => row.id === cursorId)).toBe(true);
        expect(source.data()?.length).toBeGreaterThanOrEqual(250);
      } finally {
        dispose();
      }
    }
  );

  it('does not display retained head rows after the cache becomes unavailable', async () => {
    const fake = makeFakeClient();
    getGraphqlSoupClientMock.mockReturnValue(fake.client);
    const old = [3, 2, 1].map((time) => ({
      __typename: 'GraphqlSoupDocument',
      id: `old-${time}`,
      updatedAt: new Date(time * 1000).toISOString(),
    }));
    const fresh = [
      {
        __typename: 'GraphqlSoupDocument',
        id: 'new',
        updatedAt: new Date(4000).toISOString(),
      },
      old[0],
    ];
    const records = new Map(
      [...old, ...fresh].map((row) => [`GraphqlSoupDocument:${row.id}`, row])
    );
    const host = {
      liveQueries: true,
      currentRevision: async () => REVISION_1,
      entityFilter: entityFilterMock,
      onCacheChanged: () => () => {},
      onCacheGenerationChanged: () => () => {},
    };
    const [available, setAvailable] = createSignal(true);
    getGraphqlSoupCacheHostMock.mockImplementation(() =>
      available() ? host : undefined
    );
    entityFilterMock.mockImplementation(async ({ baseline, liveQuery }) =>
      liveQuery?.release
        ? { kind: 'unsupported' }
        : {
            kind: 'live-query',
            revision: REVISION_1,
            reset: true,
            keys: baseline.map((row: { key: string }) => row.key),
            upserts: baseline.flatMap((row: { key: string }) => {
              const record = records.get(row.key);
              return record ? [{ recordKey: row.key, record }] : [];
            }),
            patches: [],
            removed: [],
            retainedKeys: [],
            optimistic: false,
          }
    );
    const ready = Promise.withResolvers<void>();
    const { source, dispose } = createRoot((dispose) => {
      const source = createSoupLiveQuery(() => ({
        sortMethod: 'UPDATED_AT',
        limit: 2,
      }));
      createComputed(() => {
        if (source.cacheMaintained()) ready.resolve();
      });
      return { source, dispose };
    });
    try {
      fake.executions[0].next(
        graphqlSoupPage({ items: old.slice(0, 2), next_cursor: 'tail' })
      );
      const tail = source.fetchNextPage();
      fake.executions[1].next(
        graphqlSoupPage({ items: old.slice(2), next_cursor: null })
      );
      await tail;
      await ready.promise;
      const head = source.refreshHead();
      fake.executions[2].next(
        graphqlSoupPage({ items: fresh, next_cursor: 'tail' })
      );
      await head;
      expect(source.fetchedRecords().map((row) => row.id)).toContain('old-2');
      setAvailable(false);
      expect(source.cacheMaintained()).toBe(false);
      expect(source.fetchedRecords().map((row) => row.id)).toEqual([
        'new',
        'old-3',
        'old-1',
      ]);
    } finally {
      dispose();
    }
  });

  it('keeps a one-page Mail projection current after a complete head refresh', async () => {
    const fake = makeFakeClient();
    getGraphqlSoupClientMock.mockReturnValue(fake.client);
    const record = {
      __typename: 'GraphqlSoupEmailThread',
      id: 'kept',
      updatedAt: '2026-01-01T00:00:00Z',
      latestInboundMessageTs: '2026-01-01T00:00:00Z',
    };
    getGraphqlSoupCacheHostMock.mockReturnValue({
      liveQueries: true,
      currentRevision: async () => REVISION_1,
      entityFilter: entityFilterMock,
      onCacheChanged: () => () => {},
      onCacheGenerationChanged: () => () => {},
    });
    entityFilterMock.mockResolvedValue({
      kind: 'mail-page',
      revision: REVISION_1,
      keys: ['GraphqlSoupEmailThread:kept'],
      retainedKeys: [],
      sortTimestamps: [],
      nextCursor: null,
      endCursor: 'edge',
      optimistic: false,
    });
    readRecordsByKeysMock.mockResolvedValue({
      revision: REVISION_1,
      records: [{ recordKey: 'GraphqlSoupEmailThread:kept', record }],
    });
    const ready = Promise.withResolvers<void>();
    const { source, dispose } = createRoot((dispose) => {
      const source = createSoupLiveQuery(() => ({
        emailView: 'INBOX',
        sortMethod: 'UPDATED_AT',
        limit: 2,
      }));
      createComputed(() => {
        if (source.cacheMaintained()) ready.resolve();
      });
      return { source, dispose };
    });
    try {
      fake.executions[0].next(
        graphqlSoupPage({ items: [record], next_cursor: null }),
        { source: 'live-network', revision: '0' }
      );
      await ready.promise;
      expect(source.cacheMaintained()).toBe(true);
      const head = source.refreshHead();
      fake.executions[1].next(
        graphqlSoupPage({ items: [record], next_cursor: null }),
        { source: 'live-network', revision: '0' }
      );
      await head;
      expect(source.cacheMaintained()).toBe(true);
      expect(source.data()?.map((row) => row.id)).toEqual(['kept']);
    } finally {
      dispose();
    }
  });

  it.each(['archived', 'labelled'] as const)(
    'fully refreshes a non-maintained reader after a tail row is %s in another client',
    async (change) => {
      const calls: Array<string | null> = [];
      let round = 0;
      const row = (id: string, label: string) => ({
        __typename: 'GraphqlSoupEmailThread',
        id,
        labels: [{ id: label, name: label }],
        latestInboundMessageTs:
          id === 'head' ? '2026-01-02T00:00:00Z' : '2026-01-01T00:00:00Z',
        updatedAt:
          id === 'head' ? '2026-01-02T00:00:00Z' : '2026-01-01T00:00:00Z',
      });
      const client = {
        executeQuery(
          request: GraphQLRequest<
            unknown,
            { input: { initial?: unknown; continuation?: { cursor: string } } }
          >,
          context: Partial<OperationContext>
        ) {
          const cursor = request.variables.input.continuation?.cursor ?? null;
          calls.push(cursor);
          if (cursor === null) round += 1;
          const items =
            cursor === null
              ? [row('head', 'Head')]
              : round === 1
                ? [row('tail', 'Old label')]
                : change === 'archived'
                  ? []
                  : [row('tail', 'New label')];
          return fromValue({
            operation: { kind: 'query', context },
            data: graphqlSoupPage({
              items,
              next_cursor: cursor === null ? 'tail' : null,
            }),
            extensions: {
              __macroNormalizedCache: {
                source: 'live-network',
                revision: REVISION_1,
              },
            },
          });
        },
      } as unknown as Client;
      getGraphqlSoupClientMock.mockReturnValue(client);
      makeGraphqlSoupInputMock.mockImplementation(({ cursor }) =>
        cursor
          ? { continuation: { cursor } }
          : { initial: { sortMethod: 'UPDATED_AT', limit: 1 } }
      );
      const { source, dispose } = createRoot((dispose) => ({
        source: createSoupLiveQuery(() => ({
          emailView: 'INBOX',
          sortMethod: 'UPDATED_AT',
          limit: 1,
        })),
        dispose,
      }));
      try {
        await source.fetchNextPage();
        expect(source.cacheMaintained()).toBe(false);
        await source.refreshHead();
        expect(
          source.data()?.map((item) => ({
            id: item.id,
            labels:
              'labels' in item ? item.labels.map((label) => label.name) : [],
          }))
        ).toEqual(
          change === 'archived'
            ? [{ id: 'head', labels: ['Head'] }]
            : [
                { id: 'head', labels: ['Head'] },
                { id: 'tail', labels: ['New label'] },
              ]
        );
        expect(calls).toEqual([null, 'tail', null, 'tail']);
      } finally {
        dispose();
      }
    }
  );

  it('reloads the non-maintained continuation when new head rows move its boundary', async () => {
    const fourth = Promise.withResolvers<void>();
    const fake = makeFakeClient((count) => {
      if (count === 4) fourth.resolve();
    });
    getGraphqlSoupClientMock.mockReturnValue(fake.client);
    makeGraphqlSoupInputMock.mockImplementation(({ cursor }) =>
      cursor
        ? { continuation: { cursor } }
        : { initial: { sortMethod: 'UPDATED_AT', limit: 100 } }
    );
    const record = (id: number) => ({
      __typename: 'GraphqlSoupDocument',
      id: String(id),
      name: String(id),
      updatedAt: new Date(id * 1000).toISOString(),
    });
    const { source, dispose } = createRoot((dispose) => ({
      source: createSoupLiveQuery(() => ({
        sortMethod: 'UPDATED_AT',
        limit: 100,
      })),
      dispose,
    }));
    try {
      fake.executions[0].next(
        graphqlSoupPage({
          items: Array.from({ length: 100 }, (_, i) => record(104 - i)),
          next_cursor: 'original-boundary',
        })
      );
      const next = source.fetchNextPage();
      fake.executions[1].next(
        graphqlSoupPage({ items: [4, 3, 2, 1].map(record), next_cursor: null })
      );
      await next;
      const head = source.refreshHead();
      fake.executions[2].next(
        graphqlSoupPage({
          items: Array.from({ length: 100 }, (_, i) => record(106 - i)),
          next_cursor: 'new-boundary',
        })
      );
      // The new server cursor covers the rows displaced from page one.
      await fourth.promise;
      expect(fake.executions[3].variables).toMatchObject({
        input: { continuation: { cursor: 'new-boundary' } },
      });
      fake.executions[3].next(
        graphqlSoupPage({
          items: [6, 5, 4, 3, 2, 1].map(record),
          next_cursor: null,
        })
      );
      await head;
      expect(fake.executions).toHaveLength(4);
      expect(source.data()?.map((row) => row.id)).toEqual(
        Array.from({ length: 106 }, (_, i) => String(106 - i))
      );
      expect(source.hasNextPage()).toBe(false);
    } finally {
      dispose();
    }
  });
});
