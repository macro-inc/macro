import type {
  Client,
  GraphQLRequest,
  Operation,
  OperationContext,
  OperationResult,
} from '@urql/core';
import { createComputed, createRoot, createSignal } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSubject } from 'wonka';

const getGraphqlSoupClientMock = vi.hoisted(() => vi.fn());
const getGraphqlSoupCacheHostMock = vi.hoisted(() => vi.fn());
const entityFilterMock = vi.hoisted(() => vi.fn());
const readRecordsByKeysMock = vi.hoisted(() => vi.fn());
const REVISION_0 = '0';
const REVISION_1 = '1';
const REVISION_2 = '2';
const mapGraphqlSoupPageMock = vi.hoisted(() =>
  vi.fn(
    (data: {
      user: { soup: { items: unknown[]; nextCursor: string | null } };
    }) => ({
      items: data.user.soup.items,
      next_cursor: data.user.soup.nextCursor,
    })
  )
);
const mapSoupPageToEntityListMock = vi.hoisted(() =>
  vi.fn((page) => page.items)
);
const makeGraphqlSoupInputMock = vi.hoisted(() => vi.fn());

vi.mock('@macro-inc/observability', () => ({
  Telemetry: {
    error: vi.fn(),
    span: vi.fn(() => ({ setAttr: vi.fn(), end: vi.fn() })),
  },
}));

vi.mock('@queries/storage/instructions-md', () => ({
  useInstructionsMdIdQuery: vi.fn(() => ({})),
}));

vi.mock('@app/lib/graphql-cache', () => ({
  selectRecords: vi.fn(() => ({})),
  readRecordsByKeys: readRecordsByKeysMock,
  normalizedCacheResultMetadata: (result: OperationResult) =>
    result.extensions?.__macroNormalizedCache,
}));

vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: getGraphqlSoupClientMock,
  getGraphqlSoupCacheHost: getGraphqlSoupCacheHostMock,
  graphqlSoupProjectionSupported: () => true,
  mapGraphqlSoupItem: vi.fn((item) => item),
  mapGraphqlSoupPage: mapGraphqlSoupPageMock,
}));

vi.mock('./ast', () => ({
  makeGraphqlSoupInput: makeGraphqlSoupInputMock,
}));

vi.mock('../transform-utils', () => ({
  mapSoupPageToEntityList: mapSoupPageToEntityListMock,
}));

import { createGraphqlSoupAstItemsQuery } from './items';

type FakeExecution = {
  variables: Record<string, unknown>;
  next(
    data: unknown,
    metadata?: {
      source: 'live-network' | 'normalized-cache-hit';
      revision?: string;
    }
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
      variables: _request.variables,
      next: (
        data,
        metadata = { source: 'live-network', revision: REVISION_1 }
      ) =>
        subject.next({
          operation,
          data,
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

describe('createGraphqlSoupAstItemsQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getGraphqlSoupCacheHostMock.mockReturnValue(undefined);
    makeGraphqlSoupInputMock.mockReturnValue({
      initial: { limit: 50, sortMethod: 'UPDATED_AT' },
    });
  });

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
        input: { continuation: { cursor: 'server-cursor-2' } },
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
          input: { continuation: { cursor: 'server-cursor-3' } },
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
      expect(mapGraphqlSoupPageMock).toHaveBeenCalledTimes(1);

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
