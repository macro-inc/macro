import {
  INITIAL_CACHE_REVISION,
  type ReadRecordsByKeysArgs,
} from '@graphql-cache/index';
import { cleanup, render, waitFor } from '@solidjs/testing-library';
import { QueryClientProvider, QueryObserver } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryClient } from '../../client';
import { useUpsertToHistoryMutation } from '../history';
import { historyKeys } from '../keys';

const mocks = vi.hoisted(() => ({
  upsert: vi.fn(),
  held: new Set<string>(),
  writeQuery: vi.fn(),
  query: vi.fn(),
}));
vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return { queryClient: new QueryClient() };
});
vi.mock('@core/context/user', () => ({ useIsAuthenticated: () => () => true }));
vi.mock('@core/constant/allBlocks', () => ({
  itemToSafeName: (item: { name: string }) => item.name,
}));
vi.mock('@service-storage/util/filename', () => ({
  formatDocumentName: (name: string) => name,
}));
vi.mock('@service-storage/client', () => ({
  storageServiceClient: { upsertItemToUserHistory: mocks.upsert },
}));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupCacheHost: () => ({
    readRecordsByKeys: async ({ keys }: ReadRecordsByKeysArgs) => ({
      revision: INITIAL_CACHE_REVISION,
      records: keys
        .filter((key) => mocks.held.has(key))
        .map((recordKey) => ({
          recordKey,
          record: {
            __typename: 'GraphqlSoupDocument',
            name: 'Old canvas',
            ownerId: 'owner',
            createdAt: '2025-01-01T00:00:00Z',
            updatedAt: '2025-01-01T00:00:00Z',
          },
        })),
    }),
    writeQuery: mocks.writeQuery,
  }),
  getGraphqlSoupClient: () => ({ query: mocks.query }),
}));

const listed = { id: 'listed', name: 'Listed', type: 'document' };

function mutate(itemId: string) {
  let mutation: ReturnType<typeof useUpsertToHistoryMutation> | undefined;
  render(() => (
    <QueryClientProvider client={queryClient}>
      {(() => {
        mutation = useUpsertToHistoryMutation();
        return null;
      })()}
    </QueryClientProvider>
  ));
  return mutation!.mutateAsync({ itemId, itemType: 'document' });
}

const stampedIds = () =>
  mocks.writeQuery.mock.calls.map(
    ([args]) => args.data.soupUpdates[0].item.id as string
  );
const historyRereads = (invalidate: { mock: { calls: unknown[][] } }) =>
  invalidate.mock.calls.filter(
    ([filters]) =>
      JSON.stringify((filters as { queryKey?: unknown }).queryKey) ===
      JSON.stringify(historyKeys.graphqlList.queryKey)
  ).length;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.held.clear();
  mocks.upsert.mockResolvedValue(ok(undefined));
  mocks.writeQuery.mockResolvedValue({ revision: INITIAL_CACHE_REVISION });
  queryClient.setQueryData(historyKeys.graphqlList.queryKey, [listed]);
});
afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.restoreAllMocks();
});

describe('a recorded view in cached history', () => {
  it('stamps an unlisted cached item and rereads history once', async () => {
    mocks.held.add('GraphqlSoupDocument:old-canvas');
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    await mutate('old-canvas');

    await waitFor(() => expect(historyRereads(invalidate)).toBe(1));
    expect(stampedIds()).toEqual(['old-canvas']);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('stamps a listed item without rereading history', async () => {
    mocks.held.add('GraphqlSoupDocument:listed');
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    await mutate('listed');

    await waitFor(() => expect(stampedIds()).toEqual(['listed']));
    expect(historyRereads(invalidate)).toBe(0);
  });

  it('loads an item the cache lacks once the server has the view', async () => {
    const order: string[] = [];
    mocks.upsert.mockImplementation(async () => {
      order.push('upsert');
      return ok(undefined);
    });
    mocks.query.mockImplementation(() => ({
      toPromise: async () => {
        order.push('load');
        mocks.held.add('GraphqlSoupDocument:shared');
        return { data: {} };
      },
    }));

    await mutate('shared');

    await waitFor(() => expect(stampedIds()).toEqual(['shared']));
    expect(order).toEqual(['upsert', 'load']);
  });

  it('reads history again when a read before the stamp is still in flight', async () => {
    mocks.held.add('GraphqlSoupDocument:old-canvas');
    queryClient.removeQueries({ queryKey: historyKeys.graphqlList.queryKey });
    let finishFirstRead: (items: unknown[]) => void = () => {};
    const reads = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishFirstRead = resolve;
          })
      )
      .mockResolvedValue([{ id: 'old-canvas' }]);
    const observer = new QueryObserver(queryClient, {
      queryKey: historyKeys.graphqlList.queryKey,
      queryFn: reads,
    });
    const unsubscribe = observer.subscribe(() => {});
    await vi.waitFor(() => expect(reads).toHaveBeenCalledTimes(1));

    await mutate('old-canvas');
    await vi.waitFor(() => expect(reads).toHaveBeenCalledTimes(2));
    finishFirstRead([]);

    await vi.waitFor(() =>
      expect(
        queryClient.getQueryData(historyKeys.graphqlList.queryKey)
      ).toEqual([{ id: 'old-canvas' }])
    );
    unsubscribe();
  });

  it('loads and stamps nothing when the server did not record the view', async () => {
    mocks.upsert.mockResolvedValue(err([{ code: 'NETWORK', message: 'x' }]));

    await expect(mutate('shared')).rejects.toBeDefined();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.writeQuery).not.toHaveBeenCalled();
  });
});
