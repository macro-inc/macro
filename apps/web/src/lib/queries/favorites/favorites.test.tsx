import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/solid-query';
import type { JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Favorite } from '../../service-clients/service-storage/generated/schemas/favorite';
import type { FavoritesList } from '../../service-clients/service-storage/generated/schemas/favoritesList';
import { favoriteKeys } from './keys';

const { graphqlSoupEnabledMock, reorderFavoritesMock } = vi.hoisted(() => ({
  graphqlSoupEnabledMock: vi.fn(() => true),
  reorderFavoritesMock: vi.fn(),
}));

vi.mock('@core/constant/featureFlags', () => ({
  enableGraphqlSoup: { key: 'enable-graphql-soup' },
  isFeatureEnabled: graphqlSoupEnabledMock,
}));

vi.mock('@service-storage/client', () => ({
  storageServiceClient: { favorites: {} },
}));

vi.mock('@service-storage/graphql-favorites', () => ({
  reorderFavorites: reorderFavoritesMock,
}));

vi.mock('../client', () => ({
  get queryClient() {
    return testQueryClient;
  },
}));

import { useReorderFavoritesMutation } from './favorites';

let testQueryClient: QueryClient;
let dispose: (() => void) | undefined;

function favorite(entityId: string, sortOrder: number): Favorite {
  return {
    entityType: 'document',
    entityId,
    sortOrder,
    createdAt: '2026-01-01T00:00:00Z',
  };
}

function renderHook<T>(factory: () => T): T {
  let hook!: T;
  dispose = render(
    () => (
      <QueryClientProvider client={testQueryClient}>
        {(() => {
          hook = factory();
          return null as unknown as JSX.Element;
        })()}
      </QueryClientProvider>
    ),
    document.body
  );
  return hook;
}

describe('favorites reorder mutation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    graphqlSoupEnabledMock.mockReturnValue(true);
    onlineManager.setOnline(true);
    testQueryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
  });

  afterEach(() => {
    onlineManager.setOnline(true);
    dispose?.();
    dispose = undefined;
    testQueryClient.clear();
    document.body.replaceChildren();
  });

  it('keeps the optimistic order when GraphQL queues the mutation offline', async () => {
    const previous: FavoritesList = {
      favorites: [favorite('document-1', 0), favorite('document-2', 1)],
    };
    testQueryClient.setQueryData(favoriteKeys.list.queryKey, previous);
    const invalidateQueries = vi.spyOn(testQueryClient, 'invalidateQueries');
    reorderFavoritesMock.mockResolvedValue({
      kind: 'queued',
      transactionId: 'transaction-1',
    });
    const mutation = renderHook(() => useReorderFavoritesMutation());
    onlineManager.setOnline(false);

    await mutation.mutateAsync({
      favorites: [
        { entityType: 'document', entityId: 'document-2' },
        { entityType: 'document', entityId: 'document-1' },
      ],
    });

    expect(reorderFavoritesMock).toHaveBeenCalledOnce();
    expect(
      testQueryClient
        .getQueryData<FavoritesList>(favoriteKeys.list.queryKey)
        ?.favorites.map((item) => item.entityId)
    ).toEqual(['document-2', 'document-1']);
    expect(invalidateQueries).not.toHaveBeenCalled();
  });

  it('revalidates the optimistic order after an immediate commit', async () => {
    testQueryClient.setQueryData<FavoritesList>(favoriteKeys.list.queryKey, {
      favorites: [favorite('document-1', 0), favorite('document-2', 1)],
    });
    const invalidateQueries = vi.spyOn(testQueryClient, 'invalidateQueries');
    reorderFavoritesMock.mockResolvedValue({ kind: 'committed' });
    const mutation = renderHook(() => useReorderFavoritesMutation());

    await mutation.mutateAsync({
      favorites: [
        { entityType: 'document', entityId: 'document-2' },
        { entityType: 'document', entityId: 'document-1' },
      ],
    });

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: favoriteKeys.list.queryKey,
    });
  });
});
