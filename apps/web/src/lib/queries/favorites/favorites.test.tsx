import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/solid-query';
import type { JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Favorite } from '../../service-clients/service-storage/generated/schemas/favorite';

const mocks = vi.hoisted(() => ({
  createGraphqlFavoritesQuery: vi.fn(),
  createGraphqlReorderMutation: vi.fn(),
  createGraphqlAddMutation: vi.fn(),
  createGraphqlRemoveMutation: vi.fn(),
  refreshGraphqlFavorites: vi.fn(),
  graphqlReorderMutate: vi.fn(),
  graphqlReorderMutateAsync: vi.fn(),
  graphqlSetMutate: vi.fn(),
  graphqlSetMutateAsync: vi.fn(),
}));

vi.mock('@core/context/user', () => ({ useIsAuthenticated: () => () => true }));

vi.mock('./graphql', () => ({
  createGraphqlFavoritesQuery: mocks.createGraphqlFavoritesQuery,
  createGraphqlReorderFavoritesMutation: mocks.createGraphqlReorderMutation,
  createGraphqlAddFavoriteMutation: mocks.createGraphqlAddMutation,
  createGraphqlRemoveFavoriteMutation: mocks.createGraphqlRemoveMutation,
  refreshActiveGraphqlFavoritesQueries: mocks.refreshGraphqlFavorites,
}));

import {
  type FavoritesFilter,
  favoriteEntityType,
  useAddFavoriteMutation,
  useFavoritesData,
  useRemoveFavoriteMutation,
  useReorderFavoritesMutation,
} from './favorites';

let testQueryClient: QueryClient;
let dispose: (() => void) | undefined;

function favorite(
  entityId: string,
  sortOrder: number,
  entityType: Favorite['entityType'] = 'document'
): Favorite {
  return {
    entityType,
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
  it('maps foreign entities to backend favorites', () => {
    expect(favoriteEntityType('foreign')).toBe('foreign_entity');
  });

  beforeEach(() => {
    vi.clearAllMocks();
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
    expect(testQueryClient.getQueryCache().getAll()).toEqual([]);
  });

  it('passes favorites filters to the GraphQL transport', () => {
    const filter: FavoritesFilter = { entityType: ['channel'] };
    renderHook(() => useFavoritesData(filter));

    expect(mocks.createGraphqlFavoritesQuery).toHaveBeenCalledWith(
      filter,
      expect.any(Function)
    );
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

  it('queues an offline reorder through GraphQL', async () => {
    const mutation = renderHook(() => useReorderFavoritesMutation());
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
    expect(testQueryClient.getMutationCache().getAll()).toEqual([]);
  });
});
