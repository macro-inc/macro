import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import type { JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Favorite } from '../../service-clients/service-storage/generated/schemas/favorite';
import type { FavoritesList } from '../../service-clients/service-storage/generated/schemas/favoritesList';
import { favoriteKeys } from './keys';

const mocks = vi.hoisted(() => ({
  graphqlSoupEnabled: vi.fn(() => true),
  createGraphqlFavoritesQuery: vi.fn(),
  createGraphqlReorderMutation: vi.fn(),
  createGraphqlAddMutation: vi.fn(),
  createGraphqlRemoveMutation: vi.fn(),
  refreshGraphqlFavorites: vi.fn(),
  graphqlReorderMutate: vi.fn(),
  graphqlReorderMutateAsync: vi.fn(),
  graphqlSetMutate: vi.fn(),
  graphqlSetMutateAsync: vi.fn(),
  getFavoritesRest: vi.fn(),
  addFavoriteRest: vi.fn(),
  removeFavoriteRest: vi.fn(),
  reorderFavoritesRest: vi.fn(),
}));

vi.mock('@core/constant/featureFlags', () => ({
  enableGraphqlSoup: { key: 'enable-graphql-soup' },
  isFeatureEnabled: mocks.graphqlSoupEnabled,
}));

vi.mock('@service-storage/client', () => ({
  storageServiceClient: {
    favorites: {
      getFavorites: mocks.getFavoritesRest,
      addFavorite: mocks.addFavoriteRest,
      removeFavoriteByEntity: mocks.removeFavoriteRest,
      reorderFavorites: mocks.reorderFavoritesRest,
    },
  },
}));

vi.mock('./graphql', () => ({
  createGraphqlFavoritesQuery: mocks.createGraphqlFavoritesQuery,
  createGraphqlReorderFavoritesMutation: mocks.createGraphqlReorderMutation,
  createGraphqlAddFavoriteMutation: mocks.createGraphqlAddMutation,
  createGraphqlRemoveFavoriteMutation: mocks.createGraphqlRemoveMutation,
  refreshActiveGraphqlFavoritesQueries: mocks.refreshGraphqlFavorites,
}));

vi.mock('../client', () => ({
  get queryClient() {
    return testQueryClient;
  },
}));

import {
  favoriteEntityType,
  useAddFavoriteMutation,
  useFavoritesData,
  useRemoveFavoriteMutation,
  useReorderFavoritesMutation,
} from './favorites';

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

describe('favorites transport', () => {
  it('maps agent sessions to their canonical favorite entity type', () => {
    expect(favoriteEntityType('agent_session')).toBe('agent_session');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.graphqlSoupEnabled.mockReturnValue(true);
    onlineManager.setOnline(true);
    testQueryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    mocks.createGraphqlFavoritesQuery.mockReturnValue({
      data: {
        favorites: [favorite('document-1', 0), favorite('document-2', 1)],
      },
      isSuccess: true,
    });
    mocks.createGraphqlReorderMutation.mockReturnValue({
      isPending: false,
      error: null,
      mutate: mocks.graphqlReorderMutate,
      mutateAsync: mocks.graphqlReorderMutateAsync,
    });
    const toggle = {
      isPending: false,
      error: null,
      mutate: mocks.graphqlSetMutate,
      mutateAsync: mocks.graphqlSetMutateAsync,
    };
    mocks.createGraphqlAddMutation.mockReturnValue(toggle);
    mocks.createGraphqlRemoveMutation.mockReturnValue(toggle);
    mocks.graphqlSetMutateAsync.mockResolvedValue(favorite('document-1', 1));
    mocks.graphqlReorderMutateAsync.mockResolvedValue({
      kind: 'queued',
      transactionId: 'transaction-1',
    });
  });

  afterEach(() => {
    onlineManager.setOnline(true);
    dispose?.();
    dispose = undefined;
    testQueryClient.clear();
    document.body.replaceChildren();
  });

  it('reads GraphQL favorites without registering a TanStack query', () => {
    const favoritesData = renderHook(() => useFavoritesData());

    expect(favoritesData()?.favorites.map((item) => item.entityId)).toEqual([
      'document-1',
      'document-2',
    ]);
    expect(mocks.createGraphqlFavoritesQuery).toHaveBeenCalledOnce();
    expect(mocks.getFavoritesRest).not.toHaveBeenCalled();
    expect(testQueryClient.getQueryCache().getAll()).toEqual([]);
  });

  it('keeps available GraphQL data visible even when its request errors', () => {
    mocks.createGraphqlFavoritesQuery.mockReturnValue({
      data: { favorites: [favorite('document-1', 0)] },
      isSuccess: false,
      isError: true,
    });
    const favoritesData = renderHook(() => useFavoritesData());
    expect(favoritesData()?.favorites).toHaveLength(1);
  });

  it('does not suspend while REST favorites are pending', () => {
    mocks.graphqlSoupEnabled.mockReturnValue(false);
    mocks.getFavoritesRest.mockReturnValue(new Promise(() => {}));
    const favoritesData = renderHook(() => useFavoritesData());
    expect(favoritesData()).toBeUndefined();
  });

  it('keeps queued reorder entirely on the captured GraphQL path', async () => {
    const mutation = renderHook(() => useReorderFavoritesMutation());
    expect(mocks.graphqlSoupEnabled).toHaveBeenCalledOnce();

    mocks.graphqlSoupEnabled.mockReturnValue(false);
    onlineManager.setOnline(false);
    const favorites = [
      { entityType: 'document' as const, entityId: 'document-2' },
      { entityType: 'document' as const, entityId: 'document-1' },
    ];

    await expect(mutation.mutateAsync({ favorites })).resolves.toEqual({
      kind: 'queued',
      transactionId: 'transaction-1',
    });

    expect(mocks.graphqlReorderMutateAsync).toHaveBeenCalledWith({ favorites });
    expect(mocks.reorderFavoritesRest).not.toHaveBeenCalled();
    expect(testQueryClient.getMutationCache().getAll()).toEqual([]);
  });

  it('uses urql-solid rather than TanStack for GraphQL add and remove', async () => {
    const mutations = renderHook(() => ({
      add: useAddFavoriteMutation(),
      remove: useRemoveFavoriteMutation(),
    }));
    const args = { entityType: 'document' as const, entityId: 'document-1' };

    await mutations.add.mutateAsync(args);
    await mutations.remove.mutateAsync(args);

    expect(mocks.createGraphqlAddMutation).toHaveBeenCalledOnce();
    expect(mocks.createGraphqlRemoveMutation).toHaveBeenCalledOnce();
    expect(mocks.graphqlSetMutateAsync).toHaveBeenCalledTimes(2);
    expect(mocks.addFavoriteRest).not.toHaveBeenCalled();
    expect(mocks.removeFavoriteRest).not.toHaveBeenCalled();
    expect(testQueryClient.getMutationCache().getAll()).toEqual([]);
  });

  it('keeps REST reorder optimism while GraphQL Soup is disabled', async () => {
    mocks.graphqlSoupEnabled.mockReturnValue(false);
    testQueryClient.setQueryData<FavoritesList>(favoriteKeys.list.queryKey, {
      favorites: [favorite('document-1', 0), favorite('document-2', 1)],
    });
    mocks.reorderFavoritesRest.mockResolvedValue(ok(undefined));
    const invalidateQueries = vi.spyOn(testQueryClient, 'invalidateQueries');
    const mutation = renderHook(() => useReorderFavoritesMutation());

    await mutation.mutateAsync({
      favorites: [
        { entityType: 'document', entityId: 'document-2' },
        { entityType: 'document', entityId: 'document-1' },
      ],
    });

    expect(
      testQueryClient
        .getQueryData<FavoritesList>(favoriteKeys.list.queryKey)
        ?.favorites.map((item) => item.entityId)
    ).toEqual(['document-2', 'document-1']);
    expect(mocks.reorderFavoritesRest).toHaveBeenCalledOnce();
    expect(mocks.createGraphqlReorderMutation).not.toHaveBeenCalled();
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: favoriteKeys.list.queryKey,
    });
  });
});
