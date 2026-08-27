import type {
  Client,
  GraphQLRequest,
  Operation,
  OperationContext,
  OperationResult,
} from '@urql/core';
import { createRoot } from 'solid-js';
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
        items: page.items,
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

  it('uses a complete local page as placeholder while authoritative network continues', async () => {
    const fake = makeFakeClient();
    getGraphqlSoupClientMock.mockReturnValue(fake.client);
    getGraphqlSoupCacheHostMock.mockReturnValue({
      currentRevision: async () => REVISION_0,
      entityFilter: entityFilterMock,
      onCacheChanged: () => () => undefined,
      onCacheGenerationChanged: () => () => undefined,
    });
    entityFilterMock.mockResolvedValue({
      kind: 'complete',
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
            expect(query.isPlaceholderData()).toBe(true);
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
        kind: 'complete',
        revision: REVISION_0,
        keys: ['GraphqlSoupDocument:task-1'],
        optimistic: true,
      })
      .mockResolvedValueOnce({
        kind: 'complete',
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
            expect(query.isPlaceholderData()).toBe(true);
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
      if (currentRevision === '4') return await revision4Filter;
      const names =
        currentRevision === REVISION_2
          ? ['Network item', 'Realtime item']
          : currentRevision === '5'
            ? ['Latest local item']
            : ['Replacement durable item'];
      return {
        kind: 'complete',
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
            : currentRevision === '5'
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
    await vi.waitFor(() => expect(entityFilterMock).toHaveBeenCalledTimes(2));
    currentRevision = '5';
    notifyCacheChanged('5');
    await vi.waitFor(() => {
      expect(query.data()?.entities.map((item) => item.name)).toEqual([
        'Latest local item',
      ]);
    });
    resolveRevision4({
      kind: 'complete',
      revision: '4',
      keys: ['GraphqlSoupDocument:stale'],
      optimistic: false,
    });
    await Promise.resolve();
    expect(query.data()?.entities.map((item) => item.name)).toEqual([
      'Latest local item',
    ]);

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
      expect(initialEntity).toEqual(firstPage.items[0]);

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
