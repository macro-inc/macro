import type {
  Client,
  GraphQLRequest,
  Operation,
  OperationContext,
  OperationResult,
} from '@urql/core';
import { CombinedError } from '@urql/core';
import { type DocumentNode, print } from 'graphql';
import { createComputed, createRoot, createSignal } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSubject } from 'wonka';

const getGraphqlSoupClientMock = vi.hoisted(() => vi.fn());
const getGraphqlSoupCacheHostMock = vi.hoisted(() => vi.fn());
const entityFilterMock = vi.hoisted(() => vi.fn());
const readRecordsByKeysMock = vi.hoisted(() => vi.fn());
const useInstructionsMdIdQueryMock = vi.hoisted(() => vi.fn());
const REVISION_0 = '0';
const REVISION_1 = '1';
const REVISION_2 = '2';
const mapGraphqlSoupItemMock = vi.hoisted(() => vi.fn((item) => item));
const mapSoupPageToEntityListMock = vi.hoisted(() =>
  vi.fn(
    (
      page,
      _options?: {
        instructionsIdQuery: { isSuccess: boolean; data?: string | null };
      }
    ) => page.items
  )
);
const makeGraphqlSoupInputMock = vi.hoisted(() => vi.fn());

vi.mock('@macro-inc/observability', () => ({
  Telemetry: {
    error: vi.fn(),
    span: vi.fn(() => ({ setAttr: vi.fn(), end: vi.fn() })),
  },
}));

vi.mock('@queries/storage/instructions-md', () => ({
  useInstructionsMdIdQuery: useInstructionsMdIdQueryMock,
}));

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
  graphqlSoupProjectionSupported: () => true,
  mapGraphqlSoupItem: mapGraphqlSoupItemMock,
}));

vi.mock('./ast', () => ({
  makeGraphqlSoupInput: makeGraphqlSoupInputMock,
}));

vi.mock('../transform-utils', () => ({
  mapApiSoupItemToEntity: vi.fn((item) => item),
  mapSoupPageToEntityList: mapSoupPageToEntityListMock,
}));

vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return { queryClient: new QueryClient() };
});

import { queryClient } from '@queries/client';
import {
  delegateChannelNotificationRefresh,
  disposeChannelNotificationRefresh,
} from '../../channel/notification-refresh';
import { getActiveGraphqlSoupRevalidations } from './active-queries';
import { createSoupLiveQuery } from './create-soup-live-query';
import { createGraphqlSoupAstItemsQuery } from './items';
import {
  createGraphqlSoupDeletion,
  GRAPHQL_SOUP_DELETE_MUTATION_KEY,
} from './optimistic-deletions';

type FakeExecution = {
  document: DocumentNode;
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

function makeFakeClient(): {
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
    return subject.source;
  };

  return {
    executions,
    client: {
      executeQuery: execute,
    } as unknown as Client,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('createGraphqlSoupAstItemsQuery', () => {
  beforeEach(() => {
    queryClient.clear();
    vi.clearAllMocks();
    useInstructionsMdIdQueryMock.mockReturnValue({ isSuccess: false });
    mapSoupPageToEntityListMock.mockImplementation((page) => page.items);
    getGraphqlSoupCacheHostMock.mockReturnValue(undefined);
    makeGraphqlSoupInputMock.mockReturnValue({
      initial: { limit: 50, sortMethod: 'UPDATED_AT' },
    });
  });

  it('owns fetching, continuation arguments, refresh and reset from a Soup declaration', async () => {
    const fake = makeFakeClient();
    getGraphqlSoupClientMock.mockReturnValue(fake.client);
    const filters = {
      projectFilter: { literal: { projectIdSelf: 'project' } },
    };
    const { query, dispose } = createRoot((dispose) => ({
      dispose,
      query: createSoupLiveQuery(() => ({
        filters,
        sortMethod: 'UPDATED_AT',
        sortDirection: 'ASC',
        emailView: 'ALL',
        limit: 2,
      })),
    }));
    try {
      expect(fake.executions[0].variables).toEqual({
        input: {
          initial: {
            filters,
            sortMethod: 'UPDATED_AT',
            sortDirection: 'ASC',
            emailView: 'ALL',
            limit: 2,
            expand: true,
          },
        },
      });
      fake.executions[0].next(
        graphqlSoupPage({ items: [{ id: 'one' }], next_cursor: 'next' })
      );
      expect(query.data()?.map((row) => row.id)).toEqual(['one']);
      const more = query.fetchNextPage();
      expect(fake.executions[1].variables).toEqual({
        input: {
          continuation: {
            cursor: 'next',
            sortDirection: 'ASC',
            emailView: 'ALL',
            expand: true,
          },
        },
      });
      fake.executions[1].next(
        graphqlSoupPage({ items: [{ id: 'two' }], next_cursor: null })
      );
      await more;
      expect(query.data()?.map((row) => row.id)).toEqual(['one', 'two']);
      query.resetToInitialPage();
      expect(query.data()?.map((row) => row.id)).toEqual(['one']);
      const refresh = query.refresh();
      await vi.waitFor(() => expect(fake.executions).toHaveLength(3));
      fake.executions[2].next(
        graphqlSoupPage({ items: [{ id: 'fresh' }], next_cursor: null })
      );
      await refresh;
      expect(query.data()?.map((row) => row.id)).toEqual(['fresh']);
      expect(mapGraphqlSoupItemMock).not.toHaveBeenCalled();
      expect(useInstructionsMdIdQueryMock).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it.each(['write', 'hydration'])(
    'constructs a live baseline from fetched pages and applies %s deltas through the public source',
    async (kind) => {
      const fake = makeFakeClient();
      getGraphqlSoupClientMock.mockReturnValue(fake.client);
      let revision = REVISION_1;
      const listeners = new Map<(value: string) => void, boolean>();
      const record = {
        __typename: 'GraphqlSoupDocument',
        id: 'one',
        documentName: 'Before',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      };
      const key = 'GraphqlSoupDocument:one';
      getGraphqlSoupCacheHostMock.mockReturnValue({
        liveQueries: true,
        currentRevision: async () => revision,
        entityFilter: entityFilterMock,
        onCacheChanged: (
          callback: (value: string) => void,
          options?: { includeHydration?: boolean }
        ) => {
          listeners.set(callback, options?.includeHydration === true);
          return () => listeners.delete(callback);
        },
        onCacheGenerationChanged: () => () => {},
      });
      entityFilterMock.mockImplementation(async (args) =>
        args.liveQuery?.release
          ? { kind: 'unsupported' }
          : {
              kind: 'live-query',
              revision,
              reset: !args.liveQuery.since,
              ...(!args.liveQuery.since ? { keys: [key] } : {}),
              upserts: !args.liveQuery.since
                ? [{ recordKey: key, record }]
                : [],
              patches: args.liveQuery.since
                ? [
                    {
                      recordKey: key,
                      fields: [{ path: ['documentName'], value: 'After' }],
                      identity: { mutationUuid: null, pending: false },
                    },
                  ]
                : [],
              removed: [],
              retainedKeys: [],
              optimistic: false,
            }
      );
      const { query, dispose } = createRoot((dispose) => ({
        dispose,
        query: createSoupLiveQuery(() => ({
          filters: {},
          sortMethod: 'UPDATED_AT',
          limit: 50,
        })),
      }));
      try {
        fake.executions[0].next(
          graphqlSoupPage({ items: [record], next_cursor: null }),
          { source: 'live-network', revision }
        );
        await vi.waitFor(() =>
          expect(query.data()?.[0]).toMatchObject({ documentName: 'Before' })
        );
        await vi.waitFor(() =>
          expect(entityFilterMock).toHaveBeenCalledWith(
            expect.objectContaining({
              baseline: [{ key, sortTimestamp: record.updatedAt }],
              liveQuery: expect.anything(),
            })
          )
        );
        const row = query.data()?.[0];
        const rows = query.data();
        revision = REVISION_2;
        listeners.forEach((includeHydration, callback) => {
          if (kind === 'write' || includeHydration) callback(revision);
        });
        await vi.waitFor(() =>
          expect(query.data()?.[0]).toMatchObject({ documentName: 'After' })
        );
        expect(query.data()?.[0]).toBe(row);
        expect(query.data()).toBe(rows);
        expect(readRecordsByKeysMock).not.toHaveBeenCalled();
        expect(fake.executions).toHaveLength(1);
      } finally {
        dispose();
      }
    }
  );

  it('keeps fetched timestamp coverage when a live version of the same row has a different timestamp', async () => {
    const fake = makeFakeClient();
    getGraphqlSoupClientMock.mockReturnValue(fake.client);
    let revision = REVISION_1;
    let notify = (_revision: string) => {};
    getGraphqlSoupCacheHostMock.mockReturnValue({
      currentRevision: async () => revision,
      entityFilter: entityFilterMock,
      onCacheChanged: (callback: typeof notify) => {
        notify = callback;
        return () => {};
      },
      onCacheGenerationChanged: () => () => {},
    });
    entityFilterMock.mockImplementation(async () => ({
      kind: 'reconciled',
      revision,
      keys: ['GraphqlSoupDocument:one'],
      retainedKeys: [],
      optimistic: false,
    }));
    readRecordsByKeysMock.mockImplementation(async () => ({
      revision,
      records: [
        {
          recordKey: 'GraphqlSoupDocument:one',
          record: {
            __typename: 'GraphqlSoupDocument',
            id: 'one',
            name: 'Live version',
            updatedAt: '2026-09-10T00:00:00Z',
          },
        },
      ],
    }));
    const { query, dispose } = createRoot((dispose) => ({
      dispose,
      query: createGraphqlSoupAstItemsQuery(
        () => ({ params: { sort_method: 'updated_at' }, body: {} }),
        () => ({ enabled: true })
      ),
    }));
    try {
      fake.executions[0].next(
        graphqlSoupPage({
          items: [
            { id: 'one', name: 'Fetched', updatedAt: '2026-09-01T00:00:00Z' },
          ],
          next_cursor: 'next',
        })
      );
      revision = REVISION_2;
      notify(revision);
      await vi.waitFor(() =>
        expect(query.data()?.entities[0]?.name).toBe('Live version')
      );
      expect(query.data()?.oldestFetchedTimestamp).toBe(
        Date.parse('2026-09-01T00:00:00Z')
      );
      expect(query.hasNextPage()).toBe(true);
    } finally {
      dispose();
    }
  });

  it('uses maintained record deltas without rereading the list or its fragments', async () => {
    const fake = makeFakeClient();
    getGraphqlSoupClientMock.mockReturnValue(fake.client);
    let revision = REVISION_1;
    const listeners = new Set<(revision: string) => void>();
    const record = {
      __typename: 'GraphqlSoupDocument',
      id: 'task',
      type: 'document',
      name: 'Before',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };
    const key = 'GraphqlSoupDocument:task';
    getGraphqlSoupCacheHostMock.mockReturnValue({
      liveQueries: true,
      currentRevision: async () => revision,
      entityFilter: entityFilterMock,
      onCacheChanged: (callback: (revision: string) => void) => {
        listeners.add(callback);
        return () => listeners.delete(callback);
      },
      onCacheGenerationChanged: () => () => {},
    });
    entityFilterMock.mockImplementation(async (args) =>
      args.liveQuery?.release
        ? { kind: 'unsupported' }
        : {
            kind: 'live-query',
            revision,
            reset: !args.liveQuery?.since,
            ...(!args.liveQuery?.since ? { keys: [key] } : {}),
            upserts: !args.liveQuery?.since ? [{ recordKey: key, record }] : [],
            patches: args.liveQuery?.since
              ? [
                  {
                    recordKey: key,
                    fields: [{ path: ['name'], value: 'After' }],
                    identity: { mutationUuid: null, pending: false },
                  },
                ]
              : [],
            removed: [],
            retainedKeys: [],
            optimistic: false,
          }
    );
    const state = createRoot((dispose) => ({
      dispose,
      query: createGraphqlSoupAstItemsQuery(
        () => ({ params: {}, body: {} }) as never,
        () => ({ enabled: true })
      ),
    }));
    try {
      fake.executions[0].next(
        graphqlSoupPage({
          items: [{ ...record, name: 'Server' }],
          next_cursor: null,
        }),
        { source: 'normalized-cache-hit', revision: REVISION_1 }
      );
      await vi.waitFor(() =>
        expect(state.query.data()?.entities[0]?.name).toBe('Before')
      );
      await vi.waitFor(() =>
        expect(
          entityFilterMock.mock.calls.some(([args]) => args.liveQuery)
        ).toBe(true)
      );
      const entity = state.query.data()?.entities[0];
      revision = REVISION_2;
      listeners.forEach((listener) => listener(revision));
      await vi.waitFor(() =>
        expect(state.query.data()?.entities[0]?.name).toBe('After')
      );
      expect(state.query.data()?.entities[0]).toBe(entity);
      expect(readRecordsByKeysMock).not.toHaveBeenCalled();
      expect(fake.executions).toHaveLength(1);
    } finally {
      state.dispose();
    }
  });

  describe('cached response errors before local reconciliation', () => {
    function fixture() {
      const fake = makeFakeClient();
      getGraphqlSoupClientMock.mockReturnValue(fake.client);
      const local = deferred<unknown>();
      let resetGeneration = () => {};
      getGraphqlSoupCacheHostMock.mockReturnValue({
        currentRevision: async () => REVISION_0,
        entityFilter: entityFilterMock,
        onCacheChanged: () => () => {},
        onCacheGenerationChanged: (callback: () => void) => {
          resetGeneration = callback;
          return () => {};
        },
      });
      entityFilterMock.mockReturnValue(local.promise);
      const [limit, setLimit] = createSignal(50);
      makeGraphqlSoupInputMock.mockImplementation(({ cursor }) =>
        cursor ? { continuation: { cursor } } : { initial: { limit: limit() } }
      );
      const root = createRoot((dispose) => ({
        dispose,
        query: createGraphqlSoupAstItemsQuery(
          () => ({ params: {}, body: {} }),
          () => ({
            enabled: true,
            projection: 'channel-list',
            keepPreviousData: true,
          })
        ),
      }));
      const error = new CombinedError({
        networkError: new TypeError('Failed to fetch'),
      });
      return {
        ...root,
        fake,
        error,
        setLimit,
        resetGeneration: () => resetGeneration(),
        cached(empty = false, failure?: CombinedError) {
          fake.executions.at(-1)!.next(
            graphqlSoupPage({
              items: empty ? [] : [{ id: 'cached-channel' }],
              next_cursor: 'next',
            }),
            { source: 'normalized-cache-hit', revision: REVISION_0 },
            failure
          );
        },
        dispose() {
          root.dispose();
          local.resolve({ kind: 'unsupported' });
        },
      };
    }

    it.each([false, true])(
      'keeps cached results quiet while reconciliation is pending (empty=%s)',
      (empty) => {
        const f = fixture();
        try {
          f.cached(empty);
          f.fake.executions[0].fail(f.error);
          expect(f.query.data()?.entities).toHaveLength(empty ? 0 : 1);
          expect(f.query.error()).toBeUndefined();
        } finally {
          f.dispose();
        }
      }
    );

    it('clears an early failure when a delayed cache hit carries the same error', () => {
      const f = fixture();
      try {
        f.fake.executions[0].fail(f.error);
        expect(f.query.error()).toBe(f.error);
        expect(f.query.data()).toBeUndefined();
        f.cached(false, f.error);
        expect(f.query.data()?.entities).toHaveLength(1);
        expect(f.query.error()).toBeUndefined();
      } finally {
        f.dispose();
      }
    });

    it('does not use retained data from other filters or a reset cache generation', () => {
      const f = fixture();
      try {
        f.cached();
        f.setLimit(20);
        f.fake.executions.at(-1)!.fail(f.error);
        expect(f.query.error()).toBe(f.error);
        f.cached(false, f.error);
        expect(f.query.error()).toBeUndefined();
        f.resetGeneration();
        expect(f.query.error()).toBe(f.error);
      } finally {
        f.dispose();
      }
    });

    it('keeps a failed load-more request visible despite cached earlier pages', async () => {
      const f = fixture();
      try {
        f.cached();
        const more = f.query.fetchNextPage();
        f.fake.executions.at(-1)!.fail(f.error);
        await more;
        expect(f.query.data()?.entities).toHaveLength(1);
        expect(f.query.error()).toBe(f.error);
      } finally {
        f.dispose();
      }
    });

    it.each([
      new CombinedError({ graphQLErrors: ['Forbidden'] }),
      new CombinedError({
        networkError: new TypeError('Failed to fetch'),
        graphQLErrors: ['Resolver failed'],
      }),
      ...[401, 403, 503].map(
        (status) =>
          new CombinedError({
            networkError: new Error('HTTP failure'),
            response: { status },
          })
      ),
    ])('does not suppress server errors with cached data: %s', (error) => {
      const f = fixture();
      try {
        f.cached(false, error);
        expect(f.query.error()).toBe(error);
      } finally {
        f.dispose();
      }
    });
  });

  describe('mixed folder contents', () => {
    const excludedId = '00000000-0000-0000-0000-000000000000';
    const item = (id: string, __typename = 'GraphqlSoupDocument') => ({
      id,
      __typename,
      projectId: 'folder-a',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-02T00:00:00Z',
    });

    function fixture(localItems = [item('cached-document')]) {
      const fake = makeFakeClient();
      getGraphqlSoupClientMock.mockReturnValue(fake.client);
      let revision = REVISION_0;
      let notify: (revision: string) => void = () => {};
      const [folder, setFolder] = createSignal('folder-a');
      const filters = () => ({
        documentFilter: { literal: { projectId: folder() } },
        chatFilter: { literal: { projectId: folder() } },
        projectFilter: { literal: { projectId: folder() } },
        emailFilter: { tree: { literal: { projectId: folder() } } },
      });
      makeGraphqlSoupInputMock.mockImplementation(({ cursor }) =>
        cursor
          ? { continuation: { cursor } }
          : {
              initial: {
                filters: filters(),
                emailView: 'ALL',
                sortMethod: 'UPDATED_AT',
                limit: 100,
              },
            }
      );
      getGraphqlSoupCacheHostMock.mockReturnValue({
        currentRevision: async () => revision,
        entityFilter: entityFilterMock,
        onCacheChanged: (callback: typeof notify) => {
          notify = callback;
          return () => {};
        },
        onCacheGenerationChanged: () => () => {},
      });
      entityFilterMock.mockImplementation(async () => ({
        kind: 'reconciled',
        revision,
        keys: localItems.map((record) => `${record.__typename}:${record.id}`),
        retainedKeys: [],
        optimistic: false,
      }));
      readRecordsByKeysMock.mockImplementation(async () => ({
        revision,
        records: localItems.map((record) => ({
          recordKey: `${record.__typename}:${record.id}`,
          record,
        })),
      }));
      const { query, dispose } = createRoot((dispose) => ({
        dispose,
        query: createGraphqlSoupAstItemsQuery(
          () => ({ params: {}, body: {} }),
          () => ({ enabled: true, localReconciliation: 'without-email' })
        ),
      }));
      return {
        fake,
        query,
        dispose,
        filters,
        setFolder,
        ids: () => query.data()?.entities.map((entity) => entity.id),
        push: () => {
          revision = String(Number(revision) + 1);
          notify(revision);
        },
      };
    }

    it('hydrates a never-visited folder without waiting for its mixed GraphQL response', async () => {
      const f = fixture([
        item('document'),
        item('chat', 'GraphqlSoupChat'),
        item('subfolder', 'GraphqlSoupProject'),
      ]);
      try {
        await vi.waitFor(() =>
          expect(f.ids()).toEqual(['document', 'chat', 'subfolder'])
        );
        expect(f.query.isLoading()).toBe(false);
        expect(f.query.isFetching()).toBe(true);
        expect(f.query.hasNextPage()).toBe(false);
        expect(f.fake.executions).toHaveLength(1);
        expect(f.fake.executions[0].variables).toMatchObject({
          input: { initial: { filters: f.filters(), emailView: 'ALL' } },
        });
        expect(entityFilterMock).toHaveBeenCalledWith({
          filters: {
            ...f.filters(),
            emailFilter: { tree: { literal: { threadId: excludedId } } },
          },
          sortMethod: 'UPDATED_AT',
          sortDirection: 'DESC',
          limit: 100,
          baseline: [],
        });
      } finally {
        f.dispose();
      }
    });

    it('retains server email and cursors across local reconciliation and later pages', async () => {
      const f = fixture();
      const email = item('email', 'GraphqlSoupEmailThread');
      const olderEmail = item('older-email', 'GraphqlSoupEmailThread');
      try {
        await vi.waitFor(() => expect(f.ids()).toEqual(['cached-document']));
        f.fake.executions[0].next(
          graphqlSoupPage({
            items: [item('server-document'), email],
            next_cursor: 'page-2',
          }),
          { source: 'normalized-cache-hit' }
        );
        f.push();
        await vi.waitFor(() =>
          expect(f.ids()).toEqual(['cached-document', 'email'])
        );
        expect(entityFilterMock.mock.lastCall?.[0].baseline).toEqual([
          {
            key: 'GraphqlSoupDocument:server-document',
            sortTimestamp: '2026-01-02T00:00:00Z',
          },
        ]);
        expect(f.query.hasNextPage()).toBe(true);
        const next = f.query.fetchNextPage();
        expect(f.fake.executions[1].variables).toEqual({
          input: {
            continuation: { cursor: 'page-2', emailView: 'ALL', expand: true },
          },
        });
        f.fake.executions[1].next(
          graphqlSoupPage({ items: [olderEmail], next_cursor: null }),
          { source: 'normalized-cache-hit' }
        );
        await next;
        await vi.waitFor(() =>
          expect(f.ids()).toEqual(['cached-document', 'email', 'older-email'])
        );
        expect(f.query.hasNextPage()).toBe(false);
        const refresh = f.query.refresh();
        f.fake.executions[2].next(
          graphqlSoupPage({ items: [email], next_cursor: null })
        );
        await refresh;
        expect(f.ids()).toEqual(['email']);
      } finally {
        f.dispose();
      }
    });

    it.each(['email-only', 'network-error'] as const)(
      'does not mistake an empty partial projection for an empty folder: %s',
      async (outcome) => {
        const f = fixture([]);
        try {
          await vi.waitFor(() =>
            expect(readRecordsByKeysMock).toHaveBeenCalled()
          );
          expect(f.query.data()).toBeUndefined();
          expect(f.query.isLoading()).toBe(true);
          if (outcome === 'network-error') {
            const error = new CombinedError({
              networkError: new Error('offline'),
            });
            f.fake.executions[0].fail(error);
            expect(f.query.error()).toBe(error);
            expect(f.query.data()).toBeUndefined();
          } else {
            f.fake.executions[0].next(
              graphqlSoupPage({
                items: [item('email', 'GraphqlSoupEmailThread')],
                next_cursor: null,
              })
            );
            expect(f.ids()).toEqual(['email']);
          }
        } finally {
          f.dispose();
        }
      }
    );

    it.each([false, true])(
      'requires visible local rows before suppressing loading/errors unless server data exists: %s',
      async (hasServerData) => {
        const f = fixture();
        const deletion = createGraphqlSoupDeletion(['cached-document']);
        const pending = deferred<void>();
        const mutation = queryClient.getMutationCache().build(queryClient, {
          mutationKey: GRAPHQL_SOUP_DELETE_MUTATION_KEY,
          onMutate: () => ({ graphqlDeletion: deletion }),
          mutationFn: () => pending.promise,
          onSettled: () => deletion.release(),
        });
        let completion: Promise<void> | undefined;
        try {
          await vi.waitFor(() => expect(f.ids()).toEqual(['cached-document']));
          if (hasServerData) {
            f.fake.executions[0].next(
              graphqlSoupPage({
                items: [item('cached-document')],
                next_cursor: null,
              }),
              { source: 'normalized-cache-hit' }
            );
          }
          completion = mutation.execute(undefined);
          await vi.waitFor(() =>
            expect(mutation.state.context?.graphqlDeletion).toBe(deletion)
          );
          await vi.waitFor(() =>
            expect(f.ids()).toEqual(hasServerData ? [] : undefined)
          );
          expect(f.query.isLoading()).toBe(!hasServerData);

          const error = new CombinedError({
            networkError: new Error('offline'),
          });
          f.fake.executions[0].fail(error);
          expect(f.query.error()).toBe(hasServerData ? undefined : error);
          expect(f.ids()).toEqual(hasServerData ? [] : undefined);

          // Releasing the deletion makes the cached projection usable again.
          deletion.release();
          await vi.waitFor(() => expect(f.ids()).toEqual(['cached-document']));
          expect(f.query.error()).toBeUndefined();
          expect(f.query.isLoading()).toBe(false);
        } finally {
          pending.resolve();
          await completion;
          deletion.release();
          f.dispose();
        }
      }
    );

    it('keeps a partial projection usable when only some cached rows are pending deletion', async () => {
      const f = fixture([item('deleted'), item('visible')]);
      const deletion = createGraphqlSoupDeletion(['deleted']);
      const pending = deferred<void>();
      const mutation = queryClient.getMutationCache().build(queryClient, {
        mutationKey: GRAPHQL_SOUP_DELETE_MUTATION_KEY,
        onMutate: () => ({ graphqlDeletion: deletion }),
        mutationFn: () => pending.promise,
        onSettled: () => deletion.release(),
      });
      let completion: Promise<void> | undefined;
      try {
        await vi.waitFor(() => expect(f.ids()).toEqual(['deleted', 'visible']));
        completion = mutation.execute(undefined);
        await vi.waitFor(() => expect(f.ids()).toEqual(['visible']));
        expect(f.query.isLoading()).toBe(false);
        f.fake.executions[0].fail(
          new CombinedError({ networkError: new Error('offline') })
        );
        expect(f.query.error()).toBeUndefined();
        expect(f.ids()).toEqual(['visible']);
      } finally {
        pending.resolve();
        await completion;
        deletion.release();
        f.dispose();
      }
    });

    it('does not leak local members across folders while a new projection is pending', async () => {
      const f = fixture();
      const pending = deferred<unknown>();
      try {
        await vi.waitFor(() => expect(f.ids()).toEqual(['cached-document']));
        entityFilterMock.mockImplementation(() => pending.promise);
        f.setFolder('folder-b');
        expect(f.query.data()).toBeUndefined();
        expect(f.query.isLoading()).toBe(true);
        await vi.waitFor(() =>
          expect(entityFilterMock.mock.lastCall?.[0].filters).toMatchObject({
            documentFilter: { literal: { projectId: 'folder-b' } },
          })
        );
        f.fake.executions[0].next(
          graphqlSoupPage({ items: [item('late-folder-a')], next_cursor: null })
        );
        expect(f.query.data()).toBeUndefined();
      } finally {
        f.dispose();
        pending.resolve({ kind: 'unsupported' });
      }
    });
  });

  it('uses the channel list projection for initial pages, pagination, refresh and reconciliation', async () => {
    const fake = makeFakeClient();
    getGraphqlSoupClientMock.mockReturnValue(fake.client);
    makeGraphqlSoupInputMock.mockImplementation(({ cursor }) =>
      cursor
        ? { continuation: { cursor } }
        : { initial: { limit: 50, sortMethod: 'UPDATED_AT' } }
    );
    getGraphqlSoupCacheHostMock.mockReturnValue({
      currentRevision: async () => REVISION_0,
      entityFilter: entityFilterMock,
      onCacheChanged: () => () => {},
      onCacheGenerationChanged: () => () => {},
    });
    entityFilterMock.mockResolvedValue({
      kind: 'reconciled',
      revision: REVISION_0,
      keys: [],
      retainedKeys: [],
      optimistic: false,
    });
    readRecordsByKeysMock.mockResolvedValue({
      revision: REVISION_0,
      records: [],
    });
    const { query, dispose } = createRoot((dispose) => ({
      dispose,
      query: createGraphqlSoupAstItemsQuery(
        () => ({ params: {}, body: {} }),
        () => ({ enabled: true, projection: 'channel-list' })
      ),
    }));
    try {
      expect(print(fake.executions[0].document)).toContain(
        'query ChannelListSoup'
      );
      fake.executions[0].next(
        graphqlSoupPage({ items: [], next_cursor: 'next' }),
        {
          source: 'normalized-cache-hit',
          revision: REVISION_0,
        }
      );
      await vi.waitFor(() => expect(readRecordsByKeysMock).toHaveBeenCalled());
      const selection = readRecordsByKeysMock.mock.calls[0][1];
      expect(print(selection.document)).toContain(
        'fragment ChannelListItemFields'
      );
      expect(print(selection.document)).not.toContain(
        'channelMessageSendMessageContent'
      );
      const more = query.fetchNextPage();
      fake.executions[1].next(
        graphqlSoupPage({ items: [], next_cursor: null })
      );
      await more;
      expect(fake.executions[1].variables).toEqual({
        input: { continuation: { cursor: 'next', expand: true } },
      });
      for (const entry of getActiveGraphqlSoupRevalidations()) {
        expect(print(entry.document)).toContain('query ChannelListSoup');
      }
      const refresh = query.refresh();
      fake.executions[2].next(
        graphqlSoupPage({ items: [], next_cursor: null })
      );
      await refresh;
      for (const execution of fake.executions) {
        expect(print(execution.document)).toContain('query ChannelListSoup');
        expect(print(execution.document)).not.toContain(
          'channelMessageSendMessageContent'
        );
      }
    } finally {
      dispose();
    }
  });

  it('keeps loaded channel pages registered for retry after a transient refresh failure', async () => {
    vi.useFakeTimers();
    const visibility = vi
      .spyOn(document, 'hidden', 'get')
      .mockReturnValue(false);
    const fake = makeFakeClient();
    getGraphqlSoupClientMock.mockReturnValue(fake.client);
    makeGraphqlSoupInputMock.mockImplementation(({ cursor }) =>
      cursor ? { continuation: { cursor } } : { initial: { limit: 50 } }
    );
    const { query, dispose } = createRoot((dispose) => ({
      dispose,
      query: createGraphqlSoupAstItemsQuery(
        () => ({ params: {}, body: {} }),
        () => ({ enabled: true, projection: 'channel-list' })
      ),
    }));
    const error = new CombinedError({ networkError: new Error('offline') });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const pageData = graphqlSoupPage({ items: [], next_cursor: null });
    const refresh = vi
      .fn()
      .mockReturnValueOnce({
        toPromise: async () => {
          fake.executions[1].fail(error);
          return { error };
        },
      })
      .mockReturnValue({
        toPromise: async () => {
          fake.executions[1].next(pageData);
          return { data: pageData };
        },
      });
    fake.client.query = refresh as unknown as Client['query'];
    try {
      fake.executions[0].next(
        graphqlSoupPage({ items: [], next_cursor: 'next' })
      );
      const more = query.fetchNextPage();
      fake.executions[1].next(pageData);
      await more;
      const page = getActiveGraphqlSoupRevalidations().find(
        (entry) => entry.variables?.input?.continuation?.cursor === 'next'
      )!;
      expect(delegateChannelNotificationRefresh(fake.client, page)).toBe(true);
      await vi.advanceTimersByTimeAsync(100);
      expect(refresh).toHaveBeenCalledOnce();
      // The refresh still retries, but its failure does not warn over a cached page.
      expect(query.error()).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1000);
      expect(refresh).toHaveBeenCalledTimes(2);
      expect(refresh).toHaveBeenLastCalledWith(page.document, page.variables, {
        requestPolicy: 'network-only',
      });
      expect(query.error()).toBeUndefined();
      query.resetToInitialPage();
      expect(delegateChannelNotificationRefresh(fake.client, page)).toBe(false);
    } finally {
      dispose();
      disposeChannelNotificationRefresh(fake.client);
      warn.mockRestore();
      visibility.mockRestore();
      vi.useRealTimers();
    }
  });

  it('registers enabled flat pages for durable replay and drops reset or unmounted pages', async () => {
    const fake = makeFakeClient();
    getGraphqlSoupClientMock.mockReturnValue(fake.client);
    makeGraphqlSoupInputMock.mockImplementation(({ cursor }) =>
      cursor ? { continuation: { cursor } } : { initial: { limit: 50 } }
    );
    const [enabled, setEnabled] = createSignal(true);
    let query!: ReturnType<typeof createGraphqlSoupAstItemsQuery>;
    const dispose = createRoot((dispose) => {
      query = createGraphqlSoupAstItemsQuery(
        () => ({ params: {}, body: {} }),
        () => ({ enabled: enabled() })
      );
      return dispose;
    });
    try {
      expect(
        getActiveGraphqlSoupRevalidations().map((query) => query.variables)
      ).toEqual([fake.executions[0].variables]);
      fake.executions[0].next(
        graphqlSoupPage({ items: [], next_cursor: 'next' })
      );
      const next = query.fetchNextPage();
      fake.executions[1].next(
        graphqlSoupPage({ items: [], next_cursor: null })
      );
      await next;
      expect(
        getActiveGraphqlSoupRevalidations().map((query) => query.variables)
      ).toEqual(fake.executions.map((execution) => execution.variables));
      query.resetToInitialPage();
      expect(getActiveGraphqlSoupRevalidations()).toHaveLength(1);
      setEnabled(false);
      expect(getActiveGraphqlSoupRevalidations()).toEqual([]);
    } finally {
      dispose();
    }
    expect(getActiveGraphqlSoupRevalidations()).toEqual([]);
  });

  it.each([
    { sort: 'touched_by_me', field: 'touchedAt' },
    { sort: 'notified_at', field: 'notifiedAt' },
    { sort: 'updated_at', field: 'updatedAt' },
  ] as const)(
    'preserves fetched coverage through display filtering ($sort)',
    async ({ sort, field }) => {
      const fake = makeFakeClient();
      getGraphqlSoupClientMock.mockReturnValue(fake.client);
      mapSoupPageToEntityListMock.mockImplementation((page) =>
        page.items.filter((item: { id: string }) => item.id === 'visible')
      );
      const { query, dispose } = createRoot((dispose) => ({
        dispose,
        query: createGraphqlSoupAstItemsQuery(
          () => ({ params: { sort_method: sort }, body: {} }),
          () => ({ enabled: true })
        ),
      }));
      try {
        fake.executions[0].next(
          graphqlSoupPage({
            items: [
              { id: 'visible', [field]: '2026-09-10T00:00:00Z' },
              { id: 'hidden', [field]: '2026-09-08T00:00:00Z' },
            ],
            next_cursor: 'next-page',
          })
        );
        expect(query.data()?.entities.map((entity) => entity.id)).toEqual([
          'visible',
        ]);
        expect(query.data()?.oldestFetchedTimestamp).toBe(
          Date.parse('2026-09-08T00:00:00Z')
        );

        const nextPage = query.fetchNextPage();
        await vi.waitFor(() => expect(fake.executions).toHaveLength(2));
        fake.executions[1].next(
          graphqlSoupPage({
            items: [{ id: 'older-hidden', [field]: '2026-09-01T00:00:00Z' }],
            next_cursor: null,
          })
        );
        await nextPage;
        expect(query.data()?.entities.map((entity) => entity.id)).toEqual([
          'visible',
        ]);
        expect(query.data()?.oldestFetchedTimestamp).toBe(
          Date.parse('2026-09-01T00:00:00Z')
        );
      } finally {
        dispose();
      }
    }
  );

  it('hides pending deletes across loaded pages and restores fresh data on failure', async () => {
    const fake = makeFakeClient();
    getGraphqlSoupClientMock.mockReturnValue(fake.client);
    const { query, dispose } = createRoot((dispose) => ({
      dispose,
      query: createGraphqlSoupAstItemsQuery(
        () => ({ params: { sort_method: 'updated_at' }, body: {} }),
        () => ({ enabled: true })
      ),
    }));
    try {
      fake.executions[0].next(
        graphqlSoupPage({ items: [{ id: 'a' }], next_cursor: 'next' })
      );
      const next = query.fetchNextPage();
      await vi.waitFor(() => expect(fake.executions).toHaveLength(2));
      fake.executions[1].next(
        graphqlSoupPage({
          items: [{ id: 'b' }, { id: 'keep' }],
          next_cursor: null,
        })
      );
      await next;
      let reject!: (error: Error) => void;
      const mutation = queryClient.getMutationCache().build(queryClient, {
        mutationKey: GRAPHQL_SOUP_DELETE_MUTATION_KEY,
        onMutate: () => ({
          graphqlDeletion: createGraphqlSoupDeletion(['a', 'b']),
        }),
        onSettled: (_data, _error, _vars, context) =>
          context?.graphqlDeletion.release(),
        mutationFn: () =>
          new Promise<void>((_resolve, fail) => {
            reject = fail;
          }),
      });
      const failed = expect(mutation.execute(undefined)).rejects.toThrow(
        'rejected'
      );
      const ids = () => query.data()?.entities.map((entity) => entity.id);
      await vi.waitFor(() => expect(ids()).toEqual(['keep']));
      // A late query response must neither resurrect pending deletes nor be
      // overwritten by a whole-page snapshot rollback.
      fake.executions[1].next(
        graphqlSoupPage({
          items: [{ id: 'b', name: 'updated' }, { id: 'new' }],
          next_cursor: null,
        })
      );
      expect(ids()).toEqual(['new']);
      reject(new Error('rejected'));
      await failed;
      await vi.waitFor(() => expect(ids()).toEqual(['a', 'b', 'new']));
    } finally {
      dispose();
    }
  });

  it('keeps other pages when one page result omits its soup payload', async () => {
    const fake = makeFakeClient();
    getGraphqlSoupClientMock.mockReturnValue(fake.client);
    const { query, dispose } = createRoot((dispose) => ({
      dispose,
      query: createGraphqlSoupAstItemsQuery(
        () => ({ params: { sort_method: 'updated_at' }, body: {} }),
        () => ({ enabled: true })
      ),
    }));
    try {
      fake.executions[0].next(
        graphqlSoupPage({ items: [{ id: 'a' }], next_cursor: 'next' })
      );
      const next = query.fetchNextPage();
      await vi.waitFor(() => expect(fake.executions).toHaveLength(2));
      fake.executions[1].next(
        graphqlSoupPage({ items: [{ id: 'b' }], next_cursor: 'more' })
      );
      await next;
      const ids = () => query.data()?.entities.map((entity) => entity.id);
      expect(ids()).toEqual(['a', 'b']);

      fake.executions[0].next({ user: { id: 'viewer' } });
      expect(query.error()).toBeUndefined();
      expect(ids()).toEqual(['b']);
      expect(query.hasNextPage()).toBe(true);

      fake.executions[1].next({ user: { id: 'viewer' } });
      expect(query.error()).toBeUndefined();
      expect(ids()).toEqual([]);
      expect(query.hasNextPage()).toBe(false);

      fake.executions[0].next(
        graphqlSoupPage({ items: [{ id: 'a' }], next_cursor: 'next' })
      );
      fake.executions[1].next(
        graphqlSoupPage({ items: [{ id: 'b' }], next_cursor: 'more' })
      );
      expect(query.error()).toBeUndefined();
      expect(ids()).toEqual(['a', 'b']);
      expect(query.hasNextPage()).toBe(true);
    } finally {
      dispose();
    }
  });

  it('retains the page projection when only query activity changes', () => {
    const fake = makeFakeClient();
    getGraphqlSoupClientMock.mockReturnValue(fake.client);
    const [enabled, setEnabled] = createSignal(true);
    const { query, dispose } = createRoot((dispose) => ({
      dispose,
      query: createGraphqlSoupAstItemsQuery(
        () => ({ params: { sort_method: 'updated_at' }, body: {} }),
        () => ({ enabled: enabled() })
      ),
    }));
    try {
      fake.executions[0].next(
        graphqlSoupPage({ items: [{ id: 'retained' }], next_cursor: null })
      );
      expect(mapGraphqlSoupItemMock).toHaveBeenCalledTimes(1);
      const entities = query.data()?.entities;

      setEnabled(false);
      expect(query.isEnabled()).toBe(false);
      setEnabled(true);
      expect(query.isEnabled()).toBe(true);
      query.resetToInitialPage();

      expect(query.data()?.entities).toBe(entities);
      expect(mapGraphqlSoupItemMock).toHaveBeenCalledTimes(1);
      expect(mapSoupPageToEntityListMock).toHaveBeenCalledTimes(1);
    } finally {
      dispose();
    }
  });

  it('reprojects cached pages when the instructions document resolves without reading pending data', () => {
    const fake = makeFakeClient();
    getGraphqlSoupClientMock.mockReturnValue(fake.client);
    const [instructions, setInstructions] = createSignal<
      { isSuccess: false } | { isSuccess: true; data: string | null }
    >({ isSuccess: false });
    const [enabled, setEnabled] = createSignal(true);
    const readInstructionsData = vi.fn(() => {
      const result = instructions();
      if (!result.isSuccess) throw new Error('Pending data read');
      return result.data;
    });
    const instructionsQuery = {
      get isSuccess() {
        return instructions().isSuccess;
      },
      get data() {
        return readInstructionsData();
      },
    };
    useInstructionsMdIdQueryMock.mockReturnValue(instructionsQuery);
    mapSoupPageToEntityListMock.mockImplementation((page, options) =>
      page.items.filter(
        (item: { id: string }) =>
          !options?.instructionsIdQuery.isSuccess ||
          item.id !== options.instructionsIdQuery.data
      )
    );
    const { query, dispose } = createRoot((dispose) => ({
      dispose,
      query: createGraphqlSoupAstItemsQuery(
        () => ({ params: { sort_method: 'updated_at' }, body: {} }),
        () => ({ enabled: enabled() })
      ),
    }));
    const ids = () => query.data()?.entities.map((entity) => entity.id);
    try {
      fake.executions[0].next(
        graphqlSoupPage({
          items: [
            { id: 'visible', updatedAt: '2026-09-10T00:00:00Z' },
            { id: 'instructions', updatedAt: '2026-09-08T00:00:00Z' },
          ],
          next_cursor: 'next-page',
        })
      );
      expect(ids()).toEqual(['visible', 'instructions']);
      expect(readInstructionsData).not.toHaveBeenCalled();
      expect(mapGraphqlSoupItemMock).toHaveBeenCalledTimes(2);

      setInstructions({ isSuccess: true, data: 'instructions' });
      expect(ids()).toEqual(['visible']);
      expect(query.data()?.oldestFetchedTimestamp).toBe(
        Date.parse('2026-09-08T00:00:00Z')
      );
      expect(query.hasNextPage()).toBe(true);
      expect(fake.executions).toHaveLength(1);
      expect(mapGraphqlSoupItemMock).toHaveBeenCalledTimes(4);

      // An identical id and activity-only changes must keep the cached selector.
      setInstructions({ isSuccess: true, data: 'instructions' });
      setEnabled(false);
      setEnabled(true);
      query.resetToInitialPage();
      expect(ids()).toEqual(['visible']);
      expect(mapGraphqlSoupItemMock).toHaveBeenCalledTimes(4);

      setInstructions({ isSuccess: true, data: 'visible' });
      expect(ids()).toEqual(['instructions']);
      expect(mapGraphqlSoupItemMock).toHaveBeenCalledTimes(6);

      setInstructions({ isSuccess: true, data: null });
      expect(ids()).toEqual(['visible', 'instructions']);
      expect(mapGraphqlSoupItemMock).toHaveBeenCalledTimes(8);
    } finally {
      dispose();
    }
  });

  it('keeps raw wire payloads outside deep store reconciliation', () => {
    mapSoupPageToEntityListMock.mockImplementation((page) =>
      page.items.map((item: { id: string }) => ({ id: item.id }))
    );
    const fake = makeFakeClient();
    getGraphqlSoupClientMock.mockReturnValue(fake.client);
    const { query, dispose } = createRoot((dispose) => ({
      dispose,
      query: createGraphqlSoupAstItemsQuery(
        () => ({ params: { sort_method: 'updated_at' }, body: {} }),
        () => ({ enabled: true })
      ),
    }));
    const metadata = { content: { message: 'large immutable payload' } };
    const descriptors = vi.spyOn(Object, 'getOwnPropertyDescriptors');
    try {
      fake.executions[0].next(
        graphqlSoupPage({
          items: [{ id: 'document', metadata }],
          next_cursor: null,
        })
      );

      expect(query.data()?.entities[0]?.id).toBe('document');
      expect(descriptors).not.toHaveBeenCalledWith(metadata);
      expect(descriptors).not.toHaveBeenCalledWith(metadata.content);
    } finally {
      descriptors.mockRestore();
      dispose();
    }
  });

  it('updates mapped entities reactively without mutating raw wire records', () => {
    mapSoupPageToEntityListMock.mockImplementation((page) =>
      page.items.map((item: object) => ({ ...item }))
    );
    const fake = makeFakeClient();
    getGraphqlSoupClientMock.mockReturnValue(fake.client);
    const names: Array<string | undefined> = [];
    const { query, dispose } = createRoot((dispose) => {
      const query = createGraphqlSoupAstItemsQuery(
        () => ({ params: { sort_method: 'updated_at' }, body: {} }),
        () => ({ enabled: true })
      );
      createComputed(() => names.push(query.data()?.entities[0]?.name));
      return { query, dispose };
    });
    try {
      const firstPage = graphqlSoupPage({
        items: [{ id: 'document', name: 'before' }],
        next_cursor: null,
      });
      fake.executions[0].next(firstPage);
      const previousEntity = query.data()?.entities[0];
      fake.executions[0].next(
        graphqlSoupPage({
          items: [{ id: 'document', name: 'after' }],
          next_cursor: null,
        })
      );

      expect(query.data()?.entities[0]?.name).toBe('after');
      expect(names).toContain('before');
      expect(names.at(-1)).toBe('after');
      expect(query.data()?.entities[0]).toBe(previousEntity);
      expect(firstPage.user.soup.items[0]).toMatchObject({ name: 'before' });
      expect(fake.executions).toHaveLength(1);
    } finally {
      dispose();
    }
  });

  it('reprojects retained pages when projection inputs change', () => {
    const fake = makeFakeClient();
    getGraphqlSoupClientMock.mockReturnValue(fake.client);
    const [sort, setSort] = createSignal<'notified_at' | 'updated_at'>(
      'updated_at'
    );
    const [showForeign, setShowForeign] = createSignal(false);
    const { query, dispose } = createRoot((dispose) => ({
      dispose,
      query: createGraphqlSoupAstItemsQuery(
        () => ({ params: { sort_method: sort() }, body: {} }),
        () => ({ enabled: true, showSupportedForeignEntities: showForeign() })
      ),
    }));
    try {
      fake.executions[0].next(
        graphqlSoupPage({
          items: [{ id: 'retained', notifiedAt: '2025-01-01T00:00:00Z' }],
          next_cursor: null,
        })
      );
      expect(query.data()?.oldestFetchedTimestamp).toBe(
        Date.parse('2026-01-01T00:00:00Z')
      );
      expect(mapGraphqlSoupItemMock).toHaveBeenCalledTimes(1);

      setSort('notified_at');
      expect(query.data()?.oldestFetchedTimestamp).toBe(
        Date.parse('2025-01-01T00:00:00Z')
      );
      expect(mapGraphqlSoupItemMock).toHaveBeenCalledTimes(2);

      setShowForeign(true);
      expect(mapGraphqlSoupItemMock).toHaveBeenCalledTimes(3);
      expect(mapSoupPageToEntityListMock).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({ showSupportedForeignEntities: true })
      );
    } finally {
      dispose();
    }
  });

  it.each([
    ['invalid', undefined],
    [undefined, Date.parse('2026-09-08T00:00:00Z')],
  ])(
    'preserves timestamp coverage with a %s timestamp',
    (notifiedAt, expected) => {
      const fake = makeFakeClient();
      getGraphqlSoupClientMock.mockReturnValue(fake.client);
      createRoot((dispose) => {
        const query = createGraphqlSoupAstItemsQuery(
          () => ({ params: { sort_method: 'notified_at' }, body: {} }),
          () => ({ enabled: true })
        );
        fake.executions[0].next(
          graphqlSoupPage({
            items: [
              { id: 'known', notifiedAt: '2026-09-08T00:00:00Z' },
              { id: 'unknown', notifiedAt },
            ],
            next_cursor: 'next-page',
          })
        );
        expect(query.data()?.oldestFetchedTimestamp).toBe(expected);
        dispose();
      });
    }
  );

  it('retains fetched coverage when display filtering hides every row', () => {
    const fake = makeFakeClient();
    getGraphqlSoupClientMock.mockReturnValue(fake.client);
    mapSoupPageToEntityListMock.mockReturnValue([]);
    const { query, dispose } = createRoot((dispose) => ({
      dispose,
      query: createGraphqlSoupAstItemsQuery(
        () => ({ params: { sort_method: 'notified_at' }, body: {} }),
        () => ({ enabled: true })
      ),
    }));
    try {
      fake.executions[0].next(
        graphqlSoupPage({
          items: [{ id: 'hidden', notifiedAt: '2026-09-08T00:00:00Z' }],
          next_cursor: 'next-page',
        })
      );
      expect(query.data()?.entities).toEqual([]);
      expect(query.data()?.oldestFetchedTimestamp).toBe(
        Date.parse('2026-09-08T00:00:00Z')
      );
      expect(query.hasNextPage()).toBe(true);
    } finally {
      dispose();
    }
  });

  it('keeps fetched timestamp coverage separate from older local cache candidates', async () => {
    const fake = makeFakeClient();
    getGraphqlSoupClientMock.mockReturnValue(fake.client);
    getGraphqlSoupCacheHostMock.mockReturnValue({
      currentRevision: async () => REVISION_0,
      entityFilter: entityFilterMock,
      onCacheChanged: () => () => {},
      onCacheGenerationChanged: () => () => {},
    });
    entityFilterMock.mockResolvedValue({
      kind: 'reconciled',
      revision: REVISION_0,
      keys: ['GraphqlSoupDocument:cached'],
      retainedKeys: [],
      optimistic: false,
    });
    readRecordsByKeysMock.mockResolvedValue({
      revision: REVISION_0,
      records: [
        {
          recordKey: 'GraphqlSoupDocument:cached',
          record: {
            __typename: 'GraphqlSoupDocument',
            id: 'cached',
            type: 'document',
            name: 'Cached',
            touchedAt: '2025-01-01T00:00:00Z',
          },
        },
      ],
    });
    const { query, dispose } = createRoot((dispose) => ({
      dispose,
      query: createGraphqlSoupAstItemsQuery(
        () => ({ params: { sort_method: 'touched_by_me' }, body: {} }),
        () => ({ enabled: true })
      ),
    }));
    try {
      await vi.waitFor(() =>
        expect(query.data()?.entities[0]?.id).toBe('cached')
      );
      expect(query.data()?.oldestFetchedTimestamp).toBeUndefined();
      fake.executions[0].next(
        graphqlSoupPage({
          items: [
            {
              id: 'fetched',
              type: 'document',
              name: 'Fetched',
              touchedAt: '2026-09-08T00:00:00Z',
            },
          ],
          next_cursor: 'next-page',
        }),
        { source: 'normalized-cache-hit', revision: REVISION_0 }
      );
      await vi.waitFor(() => {
        expect(
          query.data()?.entities.some((entity) => entity.id === 'cached')
        ).toBe(true);
        expect(query.data()?.oldestFetchedTimestamp).toBe(
          Date.parse('2026-09-08T00:00:00Z')
        );
      });
    } finally {
      dispose();
    }
  });

  it('accepts a coherent Mail page at a newer revision without repeating the filter scan', async () => {
    const fake = makeFakeClient();
    getGraphqlSoupClientMock.mockReturnValue(fake.client);
    getGraphqlSoupCacheHostMock.mockReturnValue({
      // Background hydration can advance the engine without a foreground push.
      currentRevision: vi
        .fn()
        .mockResolvedValueOnce(REVISION_0)
        .mockResolvedValue(REVISION_2),
      entityFilter: entityFilterMock,
      onCacheChanged: () => () => {},
      onCacheGenerationChanged: () => () => {},
    });
    makeGraphqlSoupInputMock.mockReturnValue({
      initial: { emailView: 'ALL', sortMethod: 'UPDATED_AT', limit: 20 },
    });
    entityFilterMock.mockResolvedValue({
      kind: 'mail-page',
      revision: REVISION_2,
      keys: [],
      sortTimestamps: [],
      nextCursor: null,
      optimistic: false,
    });
    readRecordsByKeysMock.mockResolvedValue({
      revision: REVISION_2,
      records: [],
    });
    const { query, dispose } = createRoot((dispose) => ({
      dispose,
      query: createGraphqlSoupAstItemsQuery(
        () => ({ params: {}, body: {} }),
        () => ({ enabled: true })
      ),
    }));
    try {
      await vi.waitFor(() => expect(query.data()?.cachedMail).toBe(true));
      expect(entityFilterMock).toHaveBeenCalledTimes(1);
      expect(readRecordsByKeysMock).toHaveBeenCalledTimes(1);
    } finally {
      dispose();
    }
  });

  it('keeps a newer non-Mail reconciliation authoritative after reconnect', async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    const fake = makeFakeClient();
    getGraphqlSoupClientMock.mockReturnValue(fake.client);
    let revision = REVISION_1;
    getGraphqlSoupCacheHostMock.mockReturnValue({
      currentRevision: async () => revision,
      entityFilter: entityFilterMock,
      onCacheChanged: () => () => {},
      onCacheGenerationChanged: () => () => {},
    });
    entityFilterMock.mockImplementation(async () => ({
      kind: 'reconciled',
      revision,
      keys: ['GraphqlSoupDocument:item-0'],
      retainedKeys: [],
      optimistic: false,
    }));
    readRecordsByKeysMock.mockImplementation(async () => ({
      revision,
      records: [
        {
          recordKey: 'GraphqlSoupDocument:item-0',
          record: {
            id: 'item-0',
            type: 'document',
            name: 'Hydrated local item',
          },
        },
      ],
    }));
    const { query, dispose } = createRoot((dispose) => ({
      dispose,
      query: createGraphqlSoupAstItemsQuery(
        () => ({ params: {}, body: {} }),
        () => ({ enabled: true })
      ),
    }));
    const names = () => query.data()?.entities.map((item) => item.name);
    const page = (name: string) =>
      graphqlSoupPage({
        items: [{ id: 'item-0', type: 'document', name }],
        next_cursor: null,
      });
    try {
      fake.executions[0].next(page('Old network item'), {
        source: 'live-network',
        revision: REVISION_1,
      });
      await vi.waitFor(() => expect(names()).toEqual(['Old network item']));

      // Hydration advances storage without notifying foreground readers.
      revision = REVISION_2;
      online.mockReturnValue(false);
      window.dispatchEvent(new Event('offline'));
      await vi.waitFor(() => expect(names()).toEqual(['Hydrated local item']));
      expect(entityFilterMock.mock.calls.at(-1)?.[0]).toHaveProperty(
        'baseline'
      );
      expect(entityFilterMock.mock.calls.at(-1)?.[0]).not.toHaveProperty(
        'mail'
      );

      online.mockReturnValue(true);
      window.dispatchEvent(new Event('online'));
      // Neither the synchronous publication nor a completed follow-up may
      // restore revision 1 merely because connectivity returned.
      expect(names()).toEqual(['Hydrated local item']);
      await vi.waitFor(() => expect(names()).toEqual(['Hydrated local item']));
      expect(fake.executions).toHaveLength(1);

      // A genuinely newer network snapshot must still take authority.
      revision = '3';
      fake.executions[0].next(page('Fresh network item'), {
        source: 'live-network',
        revision,
      });
      await vi.waitFor(() => expect(names()).toEqual(['Fresh network item']));
    } finally {
      dispose();
      online.mockRestore();
    }
  });

  it('paginates never-visited Mail filters offline without a server cursor or stale preview timestamps', async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const fake = makeFakeClient();
    getGraphqlSoupClientMock.mockReturnValue(fake.client);
    getGraphqlSoupCacheHostMock.mockReturnValue({
      currentRevision: async () => REVISION_0,
      entityFilter: entityFilterMock,
      onCacheChanged: () => () => {},
      onCacheGenerationChanged: () => () => {},
    });
    const keys = [
      'GraphqlSoupEmailThread:one',
      'GraphqlSoupEmailThread:two',
      'GraphqlSoupEmailThread:three',
    ];
    const ts = '2025-01-01T00:00:00.000001Z';
    entityFilterMock.mockImplementation(async (args) => {
      const index = args.filters.emailFilter ? 2 : args.mail.cursor ? 1 : 0;
      return {
        kind: 'mail-page',
        revision: REVISION_0,
        keys: [keys[index]],
        sortTimestamps: [ts],
        nextCursor: index === 0 ? 'local-next' : null,
        optimistic: false,
      };
    });
    readRecordsByKeysMock.mockImplementation(
      async (_host, _selection, requested) => ({
        revision: REVISION_0,
        records: requested.map((key: string) => ({
          recordKey: key,
          record: {
            __typename: 'GraphqlSoupEmailThread',
            id: key.split(':')[1],
            name: key,
            sortTs: 'wrong-view-timestamp',
            mailAllPreview: {
              id: `${key}-preview`,
              subject: key,
              snippet: 'canonical',
              isDraft: false,
              senderEmail: null,
              senderName: null,
              senderPhotoUrl: null,
            },
            mailDraftPreview: null,
            mailSentPreview: null,
          },
        })),
      })
    );
    let dispose!: () => void;
    let query!: ReturnType<typeof createGraphqlSoupAstItemsQuery>;
    let change!: () => void;
    createRoot((d) => {
      dispose = d;
      const [input, setInput] = createSignal({
        initial: {
          emailView: 'ALL',
          sortMethod: 'UPDATED_AT',
          limit: 1,
          filters: {},
        },
      });
      change = () =>
        setInput({
          initial: {
            emailView: 'INBOX',
            sortMethod: 'UPDATED_AT',
            limit: 1,
            filters: { emailFilter: { tree: { literal: { read: true } } } },
          },
        });
      makeGraphqlSoupInputMock.mockImplementation(() => input());
      query = createGraphqlSoupAstItemsQuery(
        () => ({ params: {}, body: {} }) as never,
        () => ({ enabled: true })
      );
    });
    try {
      await vi.waitFor(() => expect(query.data()?.entities).toHaveLength(1));
      expect(query.data()?.cachedMail).toBe(true);
      expect(query.isLoading()).toBe(false);
      expect(query.hasNextPage()).toBe(true);
      await query.fetchNextPage();
      expect(entityFilterMock.mock.calls.at(-1)?.[0].mail).toEqual({
        view: 'ALL',
        cursor: 'local-next',
      });
      expect(query.data()?.entities.map((entity) => entity.id)).toEqual([
        'one',
        'two',
      ]);
      expect(query.hasNextPage()).toBe(false);
      expect(fake.executions).toHaveLength(1);
      expect(
        (query.data()?.entities[0] as unknown as { sortTs: string } | undefined)
          ?.sortTs
      ).toBe(ts);
      fake.executions[0].next(
        graphqlSoupPage({ items: [], next_cursor: 'server-cursor' }),
        { source: 'normalized-cache-hit', revision: REVISION_0 }
      );
      expect(query.data()?.entities).toHaveLength(2);
      change();
      await vi.waitFor(() =>
        expect(query.data()?.entities[0]?.id).toBe('three')
      );
      expect(query.data()?.entities).toHaveLength(1);
      expect(entityFilterMock.mock.calls.at(-1)?.[0].mail).toEqual({
        view: 'INBOX',
      });
    } finally {
      dispose();
      online.mockRestore();
    }
  });

  it.each([
    { mail: true, kind: 'mail-page' },
    { mail: true, kind: 'incomplete' },
    { mail: true, kind: 'unsupported' },
    { mail: false, kind: 'reconciled' },
    { mail: false, kind: 'incomplete' },
    { mail: false, kind: 'unsupported' },
  ] as const)(
    'handles a failed network refresh with $kind local proof (mail=$mail)',
    async ({ mail, kind }) => {
      const fake = makeFakeClient();
      getGraphqlSoupClientMock.mockReturnValue(fake.client);
      getGraphqlSoupCacheHostMock.mockReturnValue({
        currentRevision: async () => REVISION_0,
        entityFilter: entityFilterMock,
        onCacheChanged: () => () => {},
        onCacheGenerationChanged: () => () => {},
      });
      makeGraphqlSoupInputMock.mockReturnValue({
        initial: {
          ...(mail ? { emailView: 'ALL' } : {}),
          sortMethod: 'UPDATED_AT',
          limit: 10,
        },
      });
      entityFilterMock.mockResolvedValue({
        kind,
        retainedKeys: [],
        revision: REVISION_0,
        keys: [],
        sortTimestamps: [],
        nextCursor: null,
        optimistic: false,
      });
      readRecordsByKeysMock.mockResolvedValue({
        revision: REVISION_0,
        records: [],
      });
      let dispose!: () => void;
      let query!: ReturnType<typeof createGraphqlSoupAstItemsQuery>;
      createRoot((stop) => {
        dispose = stop;
        query = createGraphqlSoupAstItemsQuery(
          () => ({ params: {}, body: {} }),
          () => ({ enabled: true })
        );
      });
      try {
        await vi.waitFor(() => expect(entityFilterMock).toHaveBeenCalled());
        const offlineError = new CombinedError({
          networkError: new Error('API disconnected'),
        });
        fake.executions[0].fail(offlineError);
        if (kind === 'mail-page' || kind === 'reconciled') {
          await vi.waitFor(() => expect(query.data()?.entities).toEqual([]));
          expect(query.data()?.cachedMail).toBe(mail);
          if (!mail)
            expect(entityFilterMock.mock.calls.at(-1)?.[0].baseline).toEqual(
              []
            );
          expect(query.error()).toBeUndefined();
          // Server-reported errors are not hidden just because local data exists.
          const serverError = new CombinedError({
            graphQLErrors: ['Forbidden'],
          });
          fake.executions[0].fail(serverError);
          expect(query.error()).toBe(serverError);
          const unauthorized = new CombinedError({
            networkError: new Error('HTTP 403'),
            response: { status: 403 },
          });
          fake.executions[0].fail(unauthorized);
          expect(query.error()).toBe(unauthorized);
          const unavailable = new CombinedError({
            networkError: new Error('HTTP 503'),
            response: { status: 503 },
          });
          fake.executions[0].fail(unavailable);
          expect(query.error()).toBe(unavailable);
        } else {
          expect(query.data()?.cachedMail).not.toBe(true);
          expect(query.error()).toBe(offlineError);
        }
      } finally {
        dispose();
      }
    }
  );

  it.each([
    { localNext: null, networkNext: 'server-next' },
    { localNext: 'local-next', networkNext: null },
  ])(
    'uses network pagination after reconnect ($localNext / $networkNext)',
    async ({ localNext, networkNext }) => {
      const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
      const fake = makeFakeClient();
      getGraphqlSoupClientMock.mockReturnValue(fake.client);
      getGraphqlSoupCacheHostMock.mockReturnValue({
        currentRevision: async () => REVISION_0,
        entityFilter: entityFilterMock,
        onCacheChanged: () => () => {},
        onCacheGenerationChanged: () => () => {},
      });
      makeGraphqlSoupInputMock.mockImplementation(({ cursor }) =>
        cursor
          ? { continuation: { cursor } }
          : {
              initial: { emailView: 'ALL', sortMethod: 'UPDATED_AT', limit: 1 },
            }
      );
      entityFilterMock.mockResolvedValue({
        kind: 'mail-page',
        revision: REVISION_0,
        keys: [],
        sortTimestamps: [],
        nextCursor: localNext,
        optimistic: false,
      });
      readRecordsByKeysMock.mockResolvedValue({
        revision: REVISION_0,
        records: [],
      });
      let dispose!: () => void;
      let query!: ReturnType<typeof createGraphqlSoupAstItemsQuery>;
      createRoot((stop) => {
        dispose = stop;
        query = createGraphqlSoupAstItemsQuery(
          () => ({ params: {}, body: {} }),
          () => ({ enabled: true })
        );
      });
      try {
        fake.executions[0].next(
          graphqlSoupPage({ items: [], next_cursor: networkNext }),
          { source: 'live-network', revision: REVISION_0 }
        );
        await vi.waitFor(() => expect(query.data()).toBeDefined());
        expect(query.data()?.cachedMail).not.toBe(true);
        online.mockReturnValue(false);
        window.dispatchEvent(new Event('offline'));
        await vi.waitFor(() => expect(query.data()?.cachedMail).toBe(true));
        expect(query.hasNextPage()).toBe(localNext !== null);
        // Reconnect at the same revision without a fresh network response. The
        // existing server baseline becomes authoritative again.
        online.mockReturnValue(true);
        window.dispatchEvent(new Event('online'));
        await vi.waitFor(() => expect(query.data()?.cachedMail).not.toBe(true));
        expect(query.hasNextPage()).toBe(networkNext !== null);
        if (networkNext) {
          const pending = query.fetchNextPage();
          await vi.waitFor(() => expect(fake.executions).toHaveLength(2));
          expect(fake.executions[1].variables).toEqual({
            input: {
              continuation: {
                cursor: networkNext,
                emailView: 'ALL',
                expand: true,
              },
            },
          });
          fake.executions[1].next(
            graphqlSoupPage({ items: [], next_cursor: null }),
            { source: 'live-network', revision: REVISION_0 }
          );
          await pending;
          expect(query.hasNextPage()).toBe(false);
        }
      } finally {
        dispose();
        online.mockRestore();
      }
    }
  );

  it.each([
    { emailView: 'INBOX', networkFirst: false, delayed: true },
    { emailView: 'DRAFTS', networkFirst: false, delayed: true },
    { emailView: 'INBOX', networkFirst: false },
    { emailView: 'DRAFTS', networkFirst: false },
    { emailView: 'INBOX', networkFirst: true },
    { emailView: 'DRAFTS', networkFirst: true },
  ])(
    'keeps a restored queued draft visible in $emailView (network first: $networkFirst, delayed: $delayed)',
    async ({ emailView, networkFirst, delayed }) => {
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
      const fake = makeFakeClient();
      getGraphqlSoupClientMock.mockReturnValue(fake.client);
      let revision = REVISION_0;
      getGraphqlSoupCacheHostMock.mockReturnValue({
        currentRevision: async () => revision,
        entityFilter: entityFilterMock,
        onCacheChanged: () => () => {},
        onCacheGenerationChanged: () => () => {},
      });
      makeGraphqlSoupInputMock.mockReturnValue({
        initial: { emailView, sortMethod: 'UPDATED_AT', limit: 20 },
      });
      const preview = {
        id: 'draft-message',
        subject: 'Offline draft',
        snippet: 'Keep me',
        isDraft: true,
        senderEmail: null,
        senderName: null,
        senderPhotoUrl: null,
      };
      entityFilterMock.mockImplementation(async () => ({
        kind: 'mail-page',
        revision,
        keys: ['GraphqlSoupEmailThread:local-draft'],
        sortTimestamps: ['2026-09-28T12:00:00Z'],
        nextCursor: null,
        optimistic: revision !== REVISION_2,
      }));
      readRecordsByKeysMock.mockImplementation(async () => ({
        revision,
        records: [
          {
            recordKey: 'GraphqlSoupEmailThread:local-draft',
            record: {
              __typename: 'GraphqlSoupEmailThread',
              id: 'local-draft',
              mailAllPreview: preview,
              mailDraftPreview: preview,
              mailSentPreview: null,
            },
          },
        ],
      }));
      let dispose!: () => void;
      let query!: ReturnType<typeof createGraphqlSoupAstItemsQuery>;
      createRoot((stop) => {
        dispose = stop;
        query = createGraphqlSoupAstItemsQuery(
          () => ({ params: {}, body: {} }),
          () => ({ enabled: true })
        );
      });
      try {
        if (networkFirst) {
          fake.executions[0].next(
            graphqlSoupPage({ items: [], next_cursor: null }),
            { source: 'live-network', revision }
          );
        }
        await vi.waitFor(() =>
          expect(query.data()?.entities.map((entity) => entity.id)).toEqual([
            'local-draft',
          ])
        );
        const write = deferred<string | undefined>();
        revision = REVISION_1;
        fake.executions[0].next(
          graphqlSoupPage({ items: [], next_cursor: null }),
          delayed
            ? { source: 'live-network', persistence: write.promise }
            : { source: 'live-network', revision }
        );
        // Keep the pending draft even before evaluation of the new revision.
        expect(query.data()?.entities.map((entity) => entity.id)).toEqual([
          'local-draft',
        ]);
        write.resolve(revision);
        await vi.waitFor(() => expect(query.localRevision?.()).toBe(revision));
        await vi.waitFor(() =>
          expect(query.data()?.entities.map((entity) => entity.id)).toEqual([
            'local-draft',
          ])
        );
        expect(query.data()?.cachedMail).toBe(true);

        // Once the write settles, the fresh server page takes over even if
        // an old local row remains. Pending preservation must not retain ghosts.
        revision = REVISION_2;
        fake.executions[0].next(
          graphqlSoupPage({
            items: [{ id: 'server-draft' }],
            next_cursor: null,
          }),
          { source: 'live-network', revision }
        );
        await vi.waitFor(() =>
          expect(query.data()?.entities.map((entity) => entity.id)).toEqual([
            'server-draft',
          ])
        );
        expect(query.data()?.cachedMail).not.toBe(true);
      } finally {
        dispose();
      }
    }
  );

  it('does not run the local filter for the implicit VIEWED_AT sort', () => {
    const fake = makeFakeClient();
    getGraphqlSoupClientMock.mockReturnValue(fake.client);
    getGraphqlSoupCacheHostMock.mockReturnValue({
      currentRevision: async () => REVISION_0,
      entityFilter: entityFilterMock,
      onCacheChanged: () => () => undefined,
      onCacheGenerationChanged: () => () => undefined,
    });
    makeGraphqlSoupInputMock.mockReturnValue({ initial: { limit: 50 } });

    createRoot((dispose) => {
      createGraphqlSoupAstItemsQuery(
        () => ({ params: {}, body: {} }) as never,
        () => ({ enabled: true })
      );

      expect(fake.executions).toHaveLength(1);
      expect(entityFilterMock).not.toHaveBeenCalled();
      dispose();
    });
  });

  it('shows current-query local data without a tab placeholder while the network continues', async () => {
    const fake = makeFakeClient();
    getGraphqlSoupClientMock.mockReturnValue(fake.client);
    getGraphqlSoupCacheHostMock.mockReturnValue({
      currentRevision: async () => REVISION_0,
      entityFilter: entityFilterMock,
      onCacheChanged: () => () => undefined,
      onCacheGenerationChanged: () => () => undefined,
    });
    entityFilterMock.mockResolvedValue({
      kind: 'reconciled',
      retainedKeys: [],
      revision: REVISION_0,
      keys: ['GraphqlSoupDocument:task-1'],
      optimistic: false,
    });
    readRecordsByKeysMock.mockResolvedValue({
      revision: REVISION_0,
      records: [
        {
          recordKey: 'GraphqlSoupDocument:task-1',
          record: { id: 'task-1', type: 'document', name: 'Local task' },
        },
      ],
    });

    await new Promise<void>((resolve) => {
      createRoot((dispose) => {
        const query = createGraphqlSoupAstItemsQuery(
          () => ({ params: {}, body: {} }) as never,
          () => ({ enabled: true })
        );

        expect(fake.executions).toHaveLength(1);
        void vi
          .waitFor(() => {
            expect(query.isPlaceholderData()).toBe(false);
            expect(query.isLoading()).toBe(false);
            expect(query.data()?.entities[0]?.name).toBe('Local task');
          })
          .then(() => {
            fake.executions[0]?.next(
              graphqlSoupPage({
                items: [
                  { id: 'task-1', type: 'document', name: 'Network task' },
                ],
                next_cursor: null,
              })
            );
            expect(query.isPlaceholderData()).toBe(false);
            expect(query.data()?.entities[0]?.name).toBe('Network task');
            dispose();
            resolve();
          });
      });
    });
    expect(entityFilterMock).toHaveBeenCalled();
  });

  it('reevaluates exact local membership after optimistic settlement', async () => {
    const fake = makeFakeClient();
    getGraphqlSoupClientMock.mockReturnValue(fake.client);
    let currentRevision = REVISION_0;
    let notifyCacheChanged: (revision: string) => void = () => undefined;
    getGraphqlSoupCacheHostMock.mockReturnValue({
      currentRevision: async () => currentRevision,
      entityFilter: entityFilterMock,
      onCacheChanged: (callback: (revision: string) => void) => {
        notifyCacheChanged = callback;
        return () => undefined;
      },
      onCacheGenerationChanged: () => () => undefined,
    });
    entityFilterMock
      .mockResolvedValueOnce({
        kind: 'reconciled',
        retainedKeys: [],
        revision: REVISION_0,
        keys: ['GraphqlSoupDocument:task-1'],
        optimistic: true,
      })
      .mockResolvedValueOnce({
        kind: 'reconciled',
        retainedKeys: [],
        revision: REVISION_2,
        keys: ['GraphqlSoupDocument:task-1'],
        optimistic: false,
      });
    readRecordsByKeysMock
      .mockResolvedValueOnce({
        revision: REVISION_0,
        records: [
          {
            recordKey: 'GraphqlSoupDocument:task-1',
            record: { id: 'task-1', type: 'document', name: 'Optimistic task' },
          },
        ],
      })
      .mockResolvedValueOnce({
        revision: REVISION_2,
        records: [
          {
            recordKey: 'GraphqlSoupDocument:task-1',
            record: { id: 'task-1', type: 'document', name: 'Network task' },
          },
        ],
      });

    await new Promise<void>((resolve) => {
      createRoot((dispose) => {
        const query = createGraphqlSoupAstItemsQuery(
          () => ({ params: {}, body: {} }) as never,
          () => ({ enabled: true })
        );

        void vi
          .waitFor(() => {
            expect(query.data()?.entities[0]?.name).toBe('Optimistic task');
            expect(query.isPlaceholderData()).toBe(false);
          })
          .then(async () => {
            fake.executions[0]?.next(
              graphqlSoupPage({
                items: [
                  { id: 'task-1', type: 'document', name: 'Network task' },
                ],
                next_cursor: null,
              })
            );
            expect(query.data()?.entities[0]?.name).toBe('Network task');

            currentRevision = REVISION_2;
            notifyCacheChanged(REVISION_2);
            await vi.waitFor(() => {
              expect(entityFilterMock).toHaveBeenCalledTimes(2);
              expect(query.data()?.entities[0]?.name).toBe('Network task');
              expect(query.isPlaceholderData()).toBe(false);
            });
            dispose();
            resolve();
          });
      });
    });
  });

  describe('network publication before persistence', () => {
    function fixture() {
      const fake = makeFakeClient();
      getGraphqlSoupClientMock.mockReturnValue(fake.client);
      let revision = REVISION_0;
      let notify: (revision: string) => void = () => {};
      let notifyGeneration: () => void = () => {};
      getGraphqlSoupCacheHostMock.mockReturnValue({
        currentRevision: async () => revision,
        entityFilter: entityFilterMock,
        onCacheChanged: (callback: typeof notify) => {
          notify = callback;
          return () => {};
        },
        onCacheGenerationChanged: (callback: typeof notifyGeneration) => {
          notifyGeneration = callback;
          return () => {};
        },
      });
      entityFilterMock.mockImplementation(async () => ({
        kind: 'reconciled',
        revision,
        keys: ['GraphqlSoupDocument:item-0'],
        retainedKeys: [],
        optimistic: true,
      }));
      readRecordsByKeysMock.mockImplementation(async () => ({
        revision,
        records: [
          {
            recordKey: 'GraphqlSoupDocument:item-0',
            record: {
              id: 'item-0',
              type: 'document',
              name: `Local ${revision}`,
            },
          },
        ],
      }));
      makeGraphqlSoupInputMock.mockImplementation(({ params, cursor }) =>
        cursor
          ? { continuation: { cursor } }
          : {
              initial: {
                limit: 50,
                sortMethod: 'UPDATED_AT',
                sortDirection: params.sort_direction === 'asc' ? 'ASC' : 'DESC',
              },
            }
      );
      const root = createRoot((dispose) => {
        const [sort, setSort] = createSignal<'asc' | 'desc'>('desc');
        const query = createGraphqlSoupAstItemsQuery(
          () => ({ params: { sort_direction: sort() }, body: {} }),
          () => ({ enabled: true })
        );
        return { dispose, query, setSort };
      });
      return {
        ...root,
        fake,
        names: () => root.query.data()?.entities.map((entity) => entity.name),
        push: (next: string) => {
          revision = next;
          notify(next);
        },
        replace: () => {
          revision = REVISION_0;
          notifyGeneration();
        },
        page: (
          name: string,
          next_cursor: string | null = null,
          id = 'item-0'
        ) =>
          graphqlSoupPage({
            items: [{ id, type: 'document', name }],
            next_cursor,
          }),
      };
    }

    it('shows network rows immediately and resumes local reconciliation after acknowledgement', async () => {
      const f = fixture();
      const write = deferred<string | undefined>();
      try {
        f.fake.executions[0].next(f.page('Network'), {
          source: 'live-network',
          persistence: write.promise,
        });
        expect(f.names()).toEqual(['Network']);
        expect(f.query.isLoading()).toBe(false);
        await Promise.resolve();
        expect(entityFilterMock).not.toHaveBeenCalled();
        write.resolve(REVISION_1);
        await Promise.resolve();
        expect(f.names()).toEqual(['Network']);
        expect(entityFilterMock).not.toHaveBeenCalled();
        f.push(REVISION_2);
        await vi.waitFor(() => expect(f.names()).toEqual(['Local 2']));
      } finally {
        f.dispose();
      }
    });

    it('does not rewind an optimistic revision that arrives before acknowledgement', async () => {
      const f = fixture();
      const write = deferred<string | undefined>();
      try {
        f.fake.executions[0].next(f.page('Network'), {
          source: 'live-network',
          persistence: write.promise,
        });
        f.push(REVISION_2);
        expect(f.names()).toEqual(['Network']);
        write.resolve(REVISION_1);
        await vi.waitFor(() => expect(f.names()).toEqual(['Local 2']));
      } finally {
        f.dispose();
      }
    });

    it('does not reassert network authority over a newer affected cache result', async () => {
      const f = fixture();
      const write = deferred<string | undefined>();
      try {
        f.fake.executions[0].next(f.page('Network'), {
          source: 'live-network',
          persistence: write.promise,
        });
        f.push(REVISION_2);
        f.fake.executions[0].next(f.page('Optimistic'), {
          source: 'affected-cache-reread',
        });
        await vi.waitFor(() => expect(f.names()).toEqual(['Local 2']));
        write.resolve(REVISION_1);
        await Promise.resolve();
        expect(f.names()).toEqual(['Local 2']);
        f.push('3');
        await vi.waitFor(() => expect(f.names()).toEqual(['Local 3']));
      } finally {
        f.dispose();
      }
    });

    it.each(['failed', 'rejected'] as const)(
      'keeps successful network rows when persistence is %s',
      async (outcome) => {
        const f = fixture();
        const write = deferred<string | undefined>();
        try {
          f.fake.executions[0].next(f.page('Network'), {
            source: 'live-network',
            persistence: write.promise,
          });
          if (outcome === 'failed') write.resolve(undefined);
          else write.reject(new Error('cache unavailable'));
          await Promise.resolve();
          f.push(REVISION_1);
          await Promise.resolve();
          expect(f.names()).toEqual(['Network']);
          expect(f.query.isLoading()).toBe(false);
          expect(entityFilterMock).not.toHaveBeenCalled();
          f.fake.executions[0].next(f.page('Recovered cache'), {
            source: 'normalized-cache-hit',
          });
          await vi.waitFor(() => expect(f.names()).toEqual(['Local 1']));
        } finally {
          f.dispose();
        }
      }
    );

    it('ignores an older acknowledgement while a newer network page is pending', async () => {
      const f = fixture();
      const first = deferred<string | undefined>();
      const second = deferred<string | undefined>();
      try {
        f.fake.executions[0].next(f.page('First'), {
          source: 'live-network',
          persistence: first.promise,
        });
        f.fake.executions[0].next(f.page('Second'), {
          source: 'live-network',
          persistence: second.promise,
        });
        first.resolve(REVISION_1);
        f.push(REVISION_1);
        await Promise.resolve();
        expect(f.names()).toEqual(['Second']);
        expect(entityFilterMock).not.toHaveBeenCalled();
        second.resolve(REVISION_2);
        f.push(REVISION_2);
        await Promise.resolve();
        expect(f.names()).toEqual(['Second']);
      } finally {
        f.dispose();
      }
    });

    it('tracks continuation-page persistence independently of the first page', async () => {
      const f = fixture();
      const first = deferred<string | undefined>();
      const second = deferred<string | undefined>();
      try {
        f.fake.executions[0].next(f.page('First', 'next'), {
          source: 'live-network',
          persistence: first.promise,
        });
        const next = f.query.fetchNextPage();
        await vi.waitFor(() => expect(f.fake.executions).toHaveLength(2));
        f.fake.executions[1].next(f.page('Second', null, 'item-1'), {
          source: 'live-network',
          persistence: second.promise,
        });
        await next;
        expect(f.names()).toEqual(['First', 'Second']);
        first.resolve(REVISION_1);
        f.push(REVISION_1);
        await Promise.resolve();
        expect(entityFilterMock).not.toHaveBeenCalled();
        expect(f.names()).toEqual(['First', 'Second']);
        second.resolve(REVISION_2);
        f.push(REVISION_2);
        await Promise.resolve();
        expect(f.names()).toEqual(['First', 'Second']);
        expect(entityFilterMock).not.toHaveBeenCalled();
      } finally {
        f.dispose();
      }
    });

    it.each(['input', 'generation', 'dispose'] as const)(
      'fences acknowledgements after a change of %s',
      async (change) => {
        const f = fixture();
        const write = deferred<string | undefined>();
        try {
          f.fake.executions[0].next(f.page('Old input'), {
            source: 'live-network',
            persistence: write.promise,
          });
          if (change === 'dispose') f.dispose();
          else {
            if (change === 'input') f.setSort('asc');
            else f.replace();
            f.fake.executions.at(-1)!.next(f.page('Current cache'), {
              source: 'normalized-cache-hit',
            });
            await vi.waitFor(() => expect(f.names()).toEqual(['Local 0']));
          }
          const calls = entityFilterMock.mock.calls.length;
          write.resolve(REVISION_1);
          await Promise.resolve();
          await Promise.resolve();
          expect(entityFilterMock).toHaveBeenCalledTimes(calls);
          if (change !== 'dispose') expect(f.names()).toEqual(['Local 0']);
        } finally {
          f.dispose();
        }
      }
    );
  });

  it('promotes realtime local revisions without a network rerun and fences stale generations', async () => {
    const fake = makeFakeClient();
    getGraphqlSoupClientMock.mockReturnValue(fake.client);
    let currentRevision = REVISION_1;
    let notifyCacheChanged: (revision: string) => void = () => undefined;
    let notifyGenerationChanged: () => void = () => undefined;
    let resolveRevision4!: (value: unknown) => void;
    let revision4Started = false;
    const revision4Filter = new Promise((resolve) => {
      resolveRevision4 = resolve;
    });
    getGraphqlSoupCacheHostMock.mockReturnValue({
      currentRevision: async () => currentRevision,
      onCacheChanged: (callback: (revision: string) => void) => {
        notifyCacheChanged = callback;
        return () => undefined;
      },
      onCacheGenerationChanged: (callback: () => void) => {
        notifyGenerationChanged = callback;
        return () => undefined;
      },
      entityFilter: entityFilterMock,
    });
    entityFilterMock.mockImplementation(async () => {
      if (currentRevision === '4') {
        revision4Started = true;
        return await revision4Filter;
      }
      const names =
        currentRevision === REVISION_2
          ? ['Network item', 'Realtime item']
          : currentRevision === '6'
            ? ['Latest local item']
            : ['Replacement durable item'];
      return {
        kind: 'reconciled',
        retainedKeys: [],
        revision: currentRevision,
        keys: names.map((_, index) => `GraphqlSoupDocument:item-${index}`),
        optimistic: false,
      };
    });
    readRecordsByKeysMock.mockImplementation(
      async (_host, _selection, keys: string[]) => {
        const names =
          currentRevision === REVISION_2
            ? ['Network item', 'Realtime item']
            : currentRevision === '6'
              ? ['Latest local item']
              : ['Replacement durable item'];
        return {
          revision: currentRevision,
          records: keys.map((recordKey, index) => ({
            recordKey,
            record: {
              id: `item-${index}`,
              type: 'document',
              name: names[index],
            },
          })),
        };
      }
    );

    let dispose!: () => void;
    let query!: ReturnType<typeof createGraphqlSoupAstItemsQuery>;
    createRoot((rootDispose) => {
      dispose = rootDispose;
      query = createGraphqlSoupAstItemsQuery(
        () => ({ params: {}, body: {} }) as never,
        () => ({ enabled: true })
      );
    });

    fake.executions[0]?.next(
      graphqlSoupPage({
        items: [{ id: 'item-0', type: 'document', name: 'Network item' }],
        next_cursor: null,
      }),
      { source: 'live-network', revision: REVISION_1 }
    );
    expect(query.data()?.entities.map((item) => item.name)).toEqual([
      'Network item',
    ]);

    currentRevision = REVISION_2;
    notifyCacheChanged(REVISION_2);
    await vi.waitFor(() => {
      expect(query.data()?.entities.map((item) => item.name)).toEqual([
        'Network item',
        'Realtime item',
      ]);
    });
    expect(fake.executions).toHaveLength(1);

    fake.executions[0]?.next(
      graphqlSoupPage({
        items: [{ id: 'item-0', type: 'document', name: 'New network item' }],
        next_cursor: null,
      }),
      { source: 'live-network', revision: '3' }
    );
    expect(query.data()?.entities.map((item) => item.name)).toEqual([
      'New network item',
    ]);

    currentRevision = '4';
    notifyCacheChanged('4');
    await vi.waitFor(() => expect(revision4Started).toBe(true));
    const callsBeforePendingChanges = entityFilterMock.mock.calls.length;
    currentRevision = '5';
    notifyCacheChanged('5');
    currentRevision = '6';
    notifyCacheChanged('6');
    await Promise.resolve();
    expect(entityFilterMock).toHaveBeenCalledTimes(callsBeforePendingChanges);
    expect(query.data()?.entities.map((item) => item.name)).toEqual([
      'New network item',
    ]);
    resolveRevision4({
      kind: 'reconciled',
      retainedKeys: [],
      revision: '4',
      keys: ['GraphqlSoupDocument:stale'],
      optimistic: false,
    });
    await vi.waitFor(() => {
      expect(entityFilterMock).toHaveBeenCalledTimes(
        callsBeforePendingChanges + 1
      );
      expect(query.data()?.entities.map((item) => item.name)).toEqual([
        'Latest local item',
      ]);
    });

    currentRevision = REVISION_0;
    notifyGenerationChanged();
    await vi.waitFor(() => {
      expect(query.data()?.entities.map((item) => item.name)).toEqual([
        'Replacement durable item',
      ]);
    });
    expect(fake.executions).toHaveLength(1);
    dispose();
  });

  it('merges baseline survivors with candidates without resetting server pagination', async () => {
    const fake = makeFakeClient();
    getGraphqlSoupClientMock.mockReturnValue(fake.client);
    let revision = REVISION_1;
    let notify: (revision: string) => void = () => {};
    getGraphqlSoupCacheHostMock.mockReturnValue({
      currentRevision: async () => revision,
      entityFilter: entityFilterMock,
      onCacheChanged: (callback: typeof notify) => {
        notify = callback;
        return () => {};
      },
      onCacheGenerationChanged: () => () => {},
    });
    makeGraphqlSoupInputMock.mockImplementation(({ cursor }) =>
      cursor
        ? { continuation: { cursor } }
        : { initial: { sortMethod: 'UPDATED_AT', limit: 2 } }
    );
    entityFilterMock.mockImplementation(async ({ baseline }) => ({
      kind: 'reconciled',
      revision,
      optimistic: false,
      // 'removed' is a confirmed non-match, 'kept' is unknown. The latter
      // need not materialize from current normalized storage to survive.
      keys: [
        'GraphqlSoupDocument:new',
        ...baseline
          .filter((entry: { key: string }) => !entry.key.endsWith(':removed'))
          .map((entry: { key: string }) => entry.key),
      ],
      retainedKeys: ['GraphqlSoupDocument:kept'],
    }));
    readRecordsByKeysMock.mockImplementation(async () => ({
      revision,
      records: [
        {
          recordKey: 'GraphqlSoupDocument:new',
          record: { id: 'new', name: 'New candidate' },
        },
      ],
    }));
    let dispose!: () => void;
    let query!: ReturnType<typeof createGraphqlSoupAstItemsQuery>;
    createRoot((stop) => {
      dispose = stop;
      query = createGraphqlSoupAstItemsQuery(
        () => ({ params: {}, body: {} }),
        () => ({ enabled: true })
      );
    });
    try {
      fake.executions[0].next(
        graphqlSoupPage({
          items: [
            { id: 'kept', name: 'Baseline survivor' },
            { id: 'removed', name: 'No longer matches' },
          ],
          next_cursor: 'server-cursor-2',
        })
      );
      revision = REVISION_2;
      notify(revision);
      await vi.waitFor(() =>
        expect(query.data()?.entities.map((item) => item.name)).toEqual([
          'New candidate',
          'Baseline survivor',
        ])
      );
      expect(fake.executions).toHaveLength(1);
      expect(query.hasNextPage()).toBe(true);
      const nextPage = query.fetchNextPage();
      await vi.waitFor(() => expect(fake.executions).toHaveLength(2));
      expect(fake.executions[1].variables).toEqual({
        input: { continuation: { cursor: 'server-cursor-2', expand: true } },
      });
      revision = '3';
      notify(revision);
      fake.executions[1].next(
        graphqlSoupPage({
          items: [{ id: 'page-2', name: 'Second page' }],
          next_cursor: null,
        }),
        { source: 'live-network', revision }
      );
      await nextPage;
      await vi.waitFor(() =>
        expect(query.data()?.entities.map((item) => item.name)).toEqual([
          'New candidate',
          'Baseline survivor',
          'Second page',
        ])
      );
      expect(query.hasNextPage()).toBe(false);
      expect(fake.executions).toHaveLength(2);
      // Once a projection covers page two, resetting the chain must not keep
      // those unloaded rows alive through that projection if reevaluation fails.
      entityFilterMock.mockRejectedValue(new Error('reconciliation failed'));
      const callsBeforeReset = entityFilterMock.mock.calls.length;
      query.resetToInitialPage();
      expect(
        query.data()?.entities.some((item) => item.name === 'Second page')
      ).toBe(false);
      await vi.waitFor(() =>
        expect(entityFilterMock.mock.calls.length).toBeGreaterThan(
          callsBeforeReset
        )
      );
      expect(
        query.data()?.entities.some((item) => item.name === 'Second page')
      ).toBe(false);
      expect(query.hasNextPage()).toBe(true);
    } finally {
      dispose();
    }
  });

  it.each(['error', 'unsupported', 'incomplete'] as const)(
    'shows later server pages while reconciliation is pending and after %s',
    async (outcome) => {
      const fake = makeFakeClient();
      getGraphqlSoupClientMock.mockReturnValue(fake.client);
      let revision = REVISION_1;
      let notify: (revision: string) => void = () => {};
      let release!: () => void;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      let retries = 0;
      getGraphqlSoupCacheHostMock.mockReturnValue({
        currentRevision: async () => revision,
        entityFilter: entityFilterMock,
        onCacheChanged: (callback: typeof notify) => {
          notify = callback;
          return () => {};
        },
        onCacheGenerationChanged: () => () => {},
      });
      makeGraphqlSoupInputMock.mockImplementation(({ cursor }) =>
        cursor
          ? { continuation: { cursor } }
          : { initial: { sortMethod: 'UPDATED_AT', limit: 2 } }
      );
      entityFilterMock.mockImplementation(async () => {
        if (revision !== REVISION_2) {
          retries += 1;
          await pending;
          if (outcome === 'error') throw new Error('reconciliation failed');
          return { kind: outcome, revision };
        }
        return {
          kind: 'reconciled',
          revision,
          keys: ['GraphqlSoupDocument:new', 'GraphqlSoupDocument:kept'],
          retainedKeys: [],
          optimistic: false,
        };
      });
      readRecordsByKeysMock.mockImplementation(async () => ({
        revision,
        records: [
          {
            recordKey: 'GraphqlSoupDocument:new',
            record: {
              __typename: 'GraphqlSoupDocument',
              id: 'new',
              name: 'New candidate',
            },
          },
        ],
      }));
      let dispose!: () => void;
      let query!: ReturnType<typeof createGraphqlSoupAstItemsQuery>;
      createRoot((stop) => {
        dispose = stop;
        query = createGraphqlSoupAstItemsQuery(
          () => ({ params: {}, body: {} }),
          () => ({ enabled: true })
        );
      });
      const names = () => query.data()?.entities.map((item) => item.name);
      try {
        fake.executions[0].next(
          graphqlSoupPage({
            items: [
              { id: 'kept', name: 'Baseline survivor' },
              { id: 'removed', name: 'Confirmed non-match' },
            ],
            next_cursor: 'server-cursor-2',
          })
        );
        revision = REVISION_2;
        notify(revision);
        await vi.waitFor(() =>
          expect(names()).toEqual(['New candidate', 'Baseline survivor'])
        );
        const secondPage = query.fetchNextPage();
        await vi.waitFor(() => expect(fake.executions).toHaveLength(2));
        revision = '3';
        notify(revision);
        fake.executions[1].next(
          graphqlSoupPage({
            // The candidate is also returned by pagination: render it only once.
            items: [
              { id: 'new', name: 'New candidate' },
              { id: 'second', name: 'Second page' },
            ],
            next_cursor: 'server-cursor-3',
          }),
          { source: 'live-network', revision }
        );
        await secondPage;
        await vi.waitFor(() => expect(retries).toBeGreaterThan(0));
        expect(names()).toEqual([
          'New candidate',
          'Baseline survivor',
          'Second page',
        ]);
        expect(query.isLoading()).toBe(false);
        expect(query.isPlaceholderData()).toBe(false);
        release();
        await vi.waitFor(() =>
          expect(entityFilterMock).toHaveBeenLastCalledWith(
            expect.objectContaining({
              baseline: expect.arrayContaining([
                expect.objectContaining({ key: 'GraphqlSoupDocument:second' }),
              ]),
            })
          )
        );
        expect(names()).toEqual([
          'New candidate',
          'Baseline survivor',
          'Second page',
        ]);
        // A second load-more must not rely on local evaluation recovering.
        const thirdPage = query.fetchNextPage();
        await vi.waitFor(() => expect(fake.executions).toHaveLength(3));
        expect(fake.executions[2].variables).toEqual({
          input: { continuation: { cursor: 'server-cursor-3', expand: true } },
        });
        revision = '4';
        notify(revision);
        fake.executions[2].next(
          graphqlSoupPage({
            items: [{ id: 'third', name: 'Third page' }],
            next_cursor: null,
          }),
          { source: 'live-network', revision }
        );
        await thirdPage;
        expect(names()).toEqual([
          'New candidate',
          'Baseline survivor',
          'Second page',
          'Third page',
        ]);
        expect(query.hasNextPage()).toBe(false);
      } finally {
        release();
        dispose();
      }
    }
  );

  it('never supplies another filter or cache generation as baseline evidence', async () => {
    const fake = makeFakeClient();
    getGraphqlSoupClientMock.mockReturnValue(fake.client);
    let revision = REVISION_1;
    let notifyGeneration: () => void = () => {};
    getGraphqlSoupCacheHostMock.mockReturnValue({
      currentRevision: async () => revision,
      entityFilter: entityFilterMock,
      onCacheChanged: () => () => {},
      onCacheGenerationChanged: (callback: () => void) => {
        notifyGeneration = callback;
        return () => {};
      },
    });
    const [scope, setScope] = createSignal('one');
    makeGraphqlSoupInputMock.mockImplementation(({ body }) => ({
      initial: { sortMethod: 'UPDATED_AT', filters: body, limit: 100 },
    }));
    entityFilterMock.mockImplementation(async () => ({
      kind: 'reconciled',
      revision,
      keys: [],
      retainedKeys: [],
      optimistic: false,
    }));
    readRecordsByKeysMock.mockImplementation(async () => ({
      revision,
      records: [],
    }));
    let dispose!: () => void;
    let query!: ReturnType<typeof createGraphqlSoupAstItemsQuery>;
    createRoot((stop) => {
      dispose = stop;
      query = createGraphqlSoupAstItemsQuery(
        () => ({ params: {}, body: { scope: scope() } }) as never,
        () => ({ enabled: true })
      );
    });
    try {
      fake.executions[0].next(
        graphqlSoupPage({
          items: [{ id: 'old', name: 'Old filter' }],
          next_cursor: null,
        })
      );
      setScope('two');
      await vi.waitFor(() => expect(fake.executions).toHaveLength(2));
      await vi.waitFor(() =>
        expect(entityFilterMock).toHaveBeenCalledWith(
          expect.objectContaining({ filters: { scope: 'two' }, baseline: [] })
        )
      );
      expect(query.data()?.entities.some((item) => item.id === 'old')).not.toBe(
        true
      );
      fake.executions[1].next(
        graphqlSoupPage({
          items: [{ id: 'new', name: 'New filter' }],
          next_cursor: null,
        })
      );
      revision = REVISION_0;
      notifyGeneration();
      await vi.waitFor(() =>
        expect(entityFilterMock).toHaveBeenLastCalledWith(
          expect.objectContaining({ baseline: [] })
        )
      );
      await vi.waitFor(() => expect(query.data()?.entities).toEqual([]));
    } finally {
      dispose();
    }
  });

  it.each(['unsupported', 'incomplete'])(
    'retains the network baseline when reconciliation is %s',
    async (kind) => {
      const fake = makeFakeClient();
      getGraphqlSoupClientMock.mockReturnValue(fake.client);
      let revision = REVISION_1;
      let notify: (revision: string) => void = () => {};
      getGraphqlSoupCacheHostMock.mockReturnValue({
        currentRevision: async () => revision,
        entityFilter: entityFilterMock,
        onCacheChanged: (callback: typeof notify) => {
          notify = callback;
          return () => {};
        },
        onCacheGenerationChanged: () => () => {},
      });
      entityFilterMock.mockImplementation(async () => ({ kind, revision }));
      let dispose!: () => void;
      let query!: ReturnType<typeof createGraphqlSoupAstItemsQuery>;
      createRoot((stop) => {
        dispose = stop;
        query = createGraphqlSoupAstItemsQuery(
          () => ({ params: {}, body: {} }),
          () => ({ enabled: true })
        );
      });
      try {
        fake.executions[0].next(
          graphqlSoupPage({
            items: [{ id: 'server', name: 'Server row' }],
            next_cursor: null,
          })
        );
        revision = REVISION_2;
        notify(revision);
        await vi.waitFor(() => expect(entityFilterMock).toHaveBeenCalled());
        expect(query.data()?.entities.map((item) => item.name)).toEqual([
          'Server row',
        ]);
      } finally {
        dispose();
      }
    }
  );

  it('batches large overlays and rejects mixed-revision materialization', async () => {
    const fake = makeFakeClient();
    getGraphqlSoupClientMock.mockReturnValue(fake.client);
    getGraphqlSoupCacheHostMock.mockReturnValue({
      currentRevision: async () => REVISION_2,
      entityFilter: entityFilterMock,
      onCacheChanged: () => () => {},
      onCacheGenerationChanged: () => () => {},
    });
    const keys = Array.from(
      { length: 501 },
      (_, i) => `GraphqlSoupDocument:${i}`
    );
    entityFilterMock.mockResolvedValue({
      kind: 'reconciled',
      revision: REVISION_2,
      keys,
      retainedKeys: [],
      optimistic: false,
    });
    let reads = 0;
    readRecordsByKeysMock.mockImplementation(
      async (_host, _selection, chunk: string[]) => ({
        revision: reads++ === 0 ? REVISION_1 : REVISION_2,
        records: chunk.map((recordKey) => ({
          recordKey,
          record: { id: recordKey, name: recordKey },
        })),
      })
    );
    let dispose!: () => void;
    let query!: ReturnType<typeof createGraphqlSoupAstItemsQuery>;
    createRoot((stop) => {
      dispose = stop;
      query = createGraphqlSoupAstItemsQuery(
        () => ({ params: {}, body: {} }),
        () => ({ enabled: true })
      );
    });
    try {
      await vi.waitFor(() => expect(query.data()?.entities).toHaveLength(501));
      expect(entityFilterMock).toHaveBeenCalledTimes(2);
      expect(
        readRecordsByKeysMock.mock.calls.map((call) => call[2].length)
      ).toEqual([500, 1, 500, 1]);
    } finally {
      dispose();
    }
  });

  it.each(['pending', 'empty', 'older rows'] as const)(
    'keeps the last local display while recomputing against a %s server page',
    async (serverPage) => {
      const fake = makeFakeClient();
      getGraphqlSoupClientMock.mockReturnValue(fake.client);
      let revision = REVISION_1;
      let notify: (revision: string) => void = () => {};
      let release!: (result: unknown) => void;
      const pending = new Promise((resolve) => {
        release = resolve;
      });
      let recomputing = false;
      getGraphqlSoupCacheHostMock.mockReturnValue({
        currentRevision: async () => revision,
        entityFilter: entityFilterMock,
        onCacheChanged: (callback: typeof notify) => {
          notify = callback;
          return () => {};
        },
        onCacheGenerationChanged: () => () => {},
      });
      const result = () => ({
        kind: 'reconciled',
        revision,
        keys: ['GraphqlSoupDocument:local'],
        retainedKeys: [],
        optimistic: false,
      });
      entityFilterMock.mockImplementation(async () => {
        if (revision === '3') {
          recomputing = true;
          return pending;
        }
        return result();
      });
      readRecordsByKeysMock.mockImplementation(async () => ({
        revision,
        records: [
          {
            recordKey: 'GraphqlSoupDocument:local',
            record: {
              id: 'local',
              name: revision === '3' ? 'Updated local row' : 'Local row',
            },
          },
        ],
      }));
      let dispose!: () => void;
      let query!: ReturnType<typeof createGraphqlSoupAstItemsQuery>;
      const displays: Array<{
        names: string[] | undefined;
        loading: boolean;
        placeholder: boolean;
      }> = [];
      createRoot((stop) => {
        dispose = stop;
        query = createGraphqlSoupAstItemsQuery(
          () => ({ params: {}, body: {} }),
          () => ({ enabled: true })
        );
        createComputed(() =>
          displays.push({
            names: query.data()?.entities.map((item) => item.name),
            loading: query.isLoading(),
            placeholder: query.isPlaceholderData(),
          })
        );
      });
      try {
        if (serverPage !== 'pending') {
          fake.executions[0].next(
            graphqlSoupPage({
              items:
                serverPage === 'empty'
                  ? []
                  : [{ id: 'server', name: 'Old server row' }],
              next_cursor: null,
            })
          );
        }
        revision = REVISION_2;
        notify(revision);
        await vi.waitFor(() =>
          expect(query.data()?.entities[0]?.name).toBe('Local row')
        );
        const previousDisplay = query.data();
        displays.length = 0;
        revision = '3';
        notify(revision);
        await vi.waitFor(() => expect(recomputing).toBe(true));
        expect(query.data()).toBe(previousDisplay);
        expect(query.isLoading()).toBe(false);
        expect(query.isPlaceholderData()).toBe(false);
        // The outstanding initial network request still has normal fetching
        // semantics; recomputation does not turn retained rows into loading.
        expect(query.isFetching()).toBe(serverPage === 'pending');
        release(result());
        await vi.waitFor(() =>
          expect(query.data()?.entities[0]?.name).toBe('Updated local row')
        );
        expect(
          displays.every(
            (display) =>
              !display.loading &&
              !display.placeholder &&
              (display.names?.[0] === 'Local row' ||
                display.names?.[0] === 'Updated local row')
          )
        ).toBe(true);
        // A failed local retry also keeps the display, not an older baseline.
        entityFilterMock.mockRejectedValue(
          new Error('temporary cache failure')
        );
        const calls = entityFilterMock.mock.calls.length;
        revision = '4';
        notify(revision);
        await vi.waitFor(() =>
          expect(entityFilterMock.mock.calls.length).toBeGreaterThan(calls)
        );
        expect(query.data()?.entities[0]?.name).toBe('Updated local row');
        expect(query.isLoading()).toBe(false);
        fake.executions[0].next(
          graphqlSoupPage({
            items: [{ id: 'fresh', name: 'Fresh server row' }],
            next_cursor: null,
          }),
          { source: 'live-network', revision: '4' }
        );
        expect(query.data()?.entities[0]?.name).toBe('Fresh server row');
      } finally {
        dispose();
      }
    }
  );

  it.each(['query', 'generation'] as const)(
    'never retains the local display across a %s change',
    async (change) => {
      const fake = makeFakeClient();
      getGraphqlSoupClientMock.mockReturnValue(fake.client);
      let revision = REVISION_1;
      let notifyGeneration: () => void = () => {};
      getGraphqlSoupCacheHostMock.mockReturnValue({
        currentRevision: async () => revision,
        entityFilter: entityFilterMock,
        onCacheChanged: () => () => {},
        onCacheGenerationChanged: (callback: () => void) => {
          notifyGeneration = callback;
          return () => {};
        },
      });
      const [scope, setScope] = createSignal('one');
      makeGraphqlSoupInputMock.mockImplementation(({ body }) => ({
        initial: { sortMethod: 'UPDATED_AT', filters: body, limit: 100 },
      }));
      entityFilterMock.mockResolvedValue({
        kind: 'reconciled',
        revision,
        keys: ['GraphqlSoupDocument:old'],
        retainedKeys: [],
        optimistic: false,
      });
      readRecordsByKeysMock.mockResolvedValue({
        revision,
        records: [
          {
            recordKey: 'GraphqlSoupDocument:old',
            record: { id: 'old', name: 'Previous local result' },
          },
        ],
      });
      let dispose!: () => void;
      let query!: ReturnType<typeof createGraphqlSoupAstItemsQuery>;
      createRoot((stop) => {
        dispose = stop;
        query = createGraphqlSoupAstItemsQuery(
          () => ({ params: {}, body: { scope: scope() } }) as never,
          () => ({ enabled: true })
        );
      });
      try {
        await vi.waitFor(() =>
          expect(query.data()?.entities[0]?.name).toBe('Previous local result')
        );
        entityFilterMock.mockImplementation(() => new Promise(() => {}));
        if (change === 'query') setScope('two');
        else {
          revision = REVISION_0;
          notifyGeneration();
        }
        expect(
          query.data()?.entities.some((item) => item.id === 'old')
        ).not.toBe(true);
        expect(query.isLoading()).toBe(true);
        expect(query.isPlaceholderData()).toBe(false);
      } finally {
        dispose();
      }
    }
  );

  it('retains identical page projections across cache re-executions', () => {
    const firstPage = {
      items: [{ id: 'task-1', type: 'document', name: 'Task' }],
      next_cursor: null,
    };
    const fake = makeFakeClient();
    getGraphqlSoupClientMock.mockReturnValue(fake.client);

    createRoot((dispose) => {
      const query = createGraphqlSoupAstItemsQuery(
        () => ({ params: {}, body: {} }) as never,
        () => ({ enabled: true })
      );

      expect(fake.executions).toHaveLength(1);
      fake.executions[0]?.next(graphqlSoupPage(firstPage));
      expect(mapGraphqlSoupItemMock).toHaveBeenCalledTimes(1);

      const initial = query.data();
      const initialEntity = initial?.entities[0];
      expect(initialEntity).toMatchObject(firstPage.items[0]);

      fake.executions[0]?.next(graphqlSoupPage(structuredClone(firstPage)));
      expect(query.data()).toBe(initial);
      expect(query.data()?.entities[0]).toBe(initialEntity);

      fake.executions[0]?.next(
        graphqlSoupPage({
          ...firstPage,
          items: [{ ...firstPage.items[0], name: 'Updated task' }],
        })
      );
      expect(query.data()?.entities[0]).toBe(initialEntity);
      expect(query.data()?.entities[0]?.name).toBe('Updated task');

      dispose();
    });
  });
});
