import { type Client, CombinedError } from '@urql/core';
import type { JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fromValue, makeSubject } from 'wonka';

const getGraphqlSoupClientMock = vi.hoisted(() => vi.fn());

vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: getGraphqlSoupClientMock,
}));

vi.mock('@core/constant/featureFlags', () => ({
  enableGraphqlSoup: {},
  isFeatureEnabled: () => true,
}));
vi.mock('@service-storage/client', () => ({ storageServiceClient: {} }));
vi.mock('../client', () => ({ queryClient: {} }));

import { useAddFavoriteMutation, useFavoritesData } from './favorites';
import {
  createGraphqlAddFavoriteMutation,
  createGraphqlFavoritesQuery,
  createGraphqlRemoveFavoriteMutation,
  createGraphqlReorderFavoritesMutation,
  refreshActiveGraphqlFavoritesQueries,
} from './graphql';

let dispose: (() => void) | undefined;
let executeQuery: ReturnType<typeof vi.fn>;
let executeMutation: ReturnType<typeof vi.fn>;

function graphqlFavorite(entityId: string, sortOrder: number) {
  return {
    __typename: 'GraphqlFavorite' as const,
    id: `document:${entityId}`,
    entityType: 'DOCUMENT' as const,
    entityId,
    sortOrder,
    createdAt: '2026-01-01T00:00:00Z',
    fileType: 'md',
    documentSubType: null,
    channelType: null,
    channelId: null,
  };
}

function favoritesResult(favorites: ReturnType<typeof graphqlFavorite>[]) {
  return {
    data: {
      user: {
        id: 'macro|favorites@example.com',
        favorites,
      },
    },
  };
}

function renderHook<T>(factory: () => T): T {
  let hook!: T;
  dispose = render(() => {
    hook = factory();
    return null as unknown as JSX.Element;
  }, document.body);
  return hook;
}

describe('GraphQL favorites queries', () => {
  beforeEach(() => {
    executeQuery = vi.fn(() =>
      fromValue(
        favoritesResult([
          graphqlFavorite('document-1', 1),
          graphqlFavorite('document-2', 0),
        ])
      )
    );
    executeMutation = vi.fn(() => ({
      toPromise: async () => ({
        data: {
          setFavorite: {
            __typename: 'SetFavoritePayload' as const,
            result: { __typename: 'GraphqlMutationSuccess' as const },
            favorite: graphqlFavorite('document-1', 1),
          },
        },
      }),
    }));
    getGraphqlSoupClientMock.mockReturnValue({
      executeQuery,
      mutation: executeMutation,
    } as unknown as Client);
  });

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    document.body.replaceChildren();
    vi.clearAllMocks();
  });

  it('retains cached favorites through a background offline failure', async () => {
    const subject = makeSubject<
      ReturnType<typeof favoritesResult> | { error: CombinedError }
    >();
    executeQuery.mockImplementation(() => subject.source);
    const state = renderHook(() => ({
      query: createGraphqlFavoritesQuery(),
      data: useFavoritesData(),
    }));
    await vi.waitFor(() => expect(executeQuery).toHaveBeenCalledTimes(2));
    subject.next(favoritesResult([graphqlFavorite('document-1', 0)]));
    await vi.waitFor(() => expect(state.data()?.favorites).toHaveLength(1));
    subject.next({
      error: new CombinedError({ networkError: new Error('offline') }),
    });
    await vi.waitFor(() => expect(state.query.isError).toBe(true));
    expect(state.data()?.favorites).toHaveLength(1);
  });

  it('keeps cache subscriptions alive after a failed explicit refresh', async () => {
    const cacheUpdates = makeSubject<
      ReturnType<typeof favoritesResult> | { error: CombinedError }
    >();
    const error = new CombinedError({ networkError: new Error('offline') });
    executeQuery.mockImplementation((_request, context) =>
      // A failed network-only request cannot register cache dependencies.
      context?.requestPolicy === 'network-only'
        ? fromValue({ error })
        : cacheUpdates.source
    );
    const data = renderHook(() => useFavoritesData());
    await vi.waitFor(() => expect(executeQuery).toHaveBeenCalledOnce());
    cacheUpdates.next(
      favoritesResult([
        graphqlFavorite('document-1', 0),
        graphqlFavorite('document-2', 1),
      ])
    );
    const refresh = refreshActiveGraphqlFavoritesQueries();
    await vi.waitFor(() => expect(executeQuery).toHaveBeenCalledTimes(2));
    cacheUpdates.next({ error });
    await refresh;
    expect(data()?.favorites).toHaveLength(2);

    // The next offline optimistic removal must reach the replacement observer.
    cacheUpdates.next(favoritesResult([graphqlFavorite('document-2', 1)]));
    expect(data()?.favorites.map((favorite) => favorite.entityId)).toEqual([
      'document-2',
    ]);
  });

  it('returns the add payload consistently without any mounted query', async () => {
    const context = { rollback: vi.fn() };
    const onSuccess = vi.fn();
    const onSettled = vi.fn();
    const mutation = renderHook(() =>
      useAddFavoriteMutation({
        onMutate: () => context,
        onSuccess,
        onSettled,
      })
    );
    const input = { entityType: 'document' as const, entityId: 'document-1' };
    const result = await mutation.mutateAsync(input);
    expect(result).toMatchObject({
      entityId: 'document-1',
      sortOrder: 1,
      fileType: 'md',
      createdAt: '2026-01-01T00:00:00Z',
    });
    expect(onSuccess).toHaveBeenCalledWith(result, input, context);
    expect(onSettled).toHaveBeenCalledWith(result, null, input, context);
    expect(executeQuery).not.toHaveBeenCalled();
  });

  it('does not replace an add response with a stale mounted query record', async () => {
    executeQuery.mockImplementation(() =>
      fromValue(favoritesResult([graphqlFavorite('document-1', 99)]))
    );
    const hooks = renderHook(() => ({
      query: createGraphqlFavoritesQuery(),
      mutation: useAddFavoriteMutation(),
    }));
    const result = await hooks.mutation.mutateAsync({
      entityType: 'document',
      entityId: 'document-1',
    });
    expect(result?.sortOrder).toBe(1);
    expect(hooks.query.data?.favorites[0].sortOrder).toBe(99);
  });

  it('accepts superseded toggles without an error or stale-data refetch', async () => {
    executeMutation.mockReturnValue({
      toPromise: async () => ({
        extensions: {
          normalizedCacheMutationDisposition: {
            kind: 'superseded',
            transactionId: 'old',
            replacementTransactionId: 'new',
          },
        },
      }),
    });
    const onError = vi.fn();
    const onSuccess = vi.fn();
    const hooks = renderHook(() => ({
      query: createGraphqlFavoritesQuery(),
      mutation: createGraphqlAddFavoriteMutation({ onError, onSuccess }),
    }));
    const input = { entityType: 'document' as const, entityId: 'document-1' };
    await expect(hooks.mutation.mutateAsync(input)).resolves.toBeUndefined();
    expect(onError).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledWith(undefined, input, undefined);
    expect(executeQuery).toHaveBeenCalledOnce();
  });

  it('runs the error lifecycle rather than success when a toggle is rejected', async () => {
    const error = new CombinedError({
      graphQLErrors: [new Error('not authorized')],
    });
    executeMutation.mockReturnValue({ toPromise: async () => ({ error }) });
    const onError = vi.fn();
    const onSuccess = vi.fn();
    const onSettled = vi.fn();
    const mutation = renderHook(() =>
      createGraphqlRemoveFavoriteMutation({ onError, onSuccess, onSettled })
    );
    const input = { entityType: 'document' as const, entityId: 'document-1' };
    await expect(mutation.mutateAsync(input)).rejects.toBe(error);
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(error, input, undefined);
    expect(onSettled).toHaveBeenCalledWith(undefined, error, input, undefined);
    expect(mutation.error).toBe(error);
    expect(mutation.isPending).toBe(false);
  });

  it('reports queued reorder identically to callbacks and mutateAsync', async () => {
    executeMutation.mockReturnValue({
      toPromise: async () => ({
        extensions: {
          normalizedCacheMutationDisposition: {
            kind: 'queued',
            transactionId: 'order-1',
          },
        },
      }),
    });
    const onSuccess = vi.fn();
    const onSettled = vi.fn();
    const hooks = renderHook(() => ({
      query: createGraphqlFavoritesQuery(),
      mutation: createGraphqlReorderFavoritesMutation({ onSuccess, onSettled }),
    }));
    const input = {
      favorites: [{ entityType: 'document' as const, entityId: 'document-1' }],
    };
    const result = await hooks.mutation.mutateAsync(input);
    expect(result).toEqual({ kind: 'queued', transactionId: 'order-1' });
    expect(onSuccess).toHaveBeenCalledWith(result, input, undefined);
    expect(onSettled).toHaveBeenCalledWith(result, null, input, undefined);
    expect(executeQuery).toHaveBeenCalledOnce();
  });

  it('projects the live GraphQL list in normalized sort order', async () => {
    const query = renderHook(() => createGraphqlFavoritesQuery());

    await vi.waitFor(() => expect(query.isSuccess).toBe(true));
    expect(query.data?.favorites.map((favorite) => favorite.entityId)).toEqual([
      'document-2',
      'document-1',
    ]);
    expect(query.data?.favorites[0]).toMatchObject({
      entityType: 'document',
      fileType: 'md',
    });
    expect(executeQuery).toHaveBeenCalledWith(
      expect.objectContaining({ variables: {} }),
      { requestPolicy: 'cache-and-network' }
    );
  });

  it('refetches the urql-solid list after setting a favorite', async () => {
    const onSuccess = vi.fn();
    const hooks = renderHook(() => ({
      query: createGraphqlFavoritesQuery(),
      mutation: createGraphqlAddFavoriteMutation({ onSuccess }),
    }));

    await hooks.mutation.mutateAsync({
      entityType: 'document',
      entityId: 'document-1',
    });

    expect(executeMutation).toHaveBeenCalledWith(
      expect.anything(),
      {
        entity: { type: 'DOCUMENT', id: 'document-1' },
        favorite: true,
      },
      {
        normalizedCacheOptimistic: expect.objectContaining({
          optimisticResponse: {
            setFavorite: expect.objectContaining({
              __typename: 'SetFavoritePayload',
              result: { __typename: 'GraphqlMutationSuccess' },
              favorite: expect.objectContaining({
                id: 'document:document-1',
                sortOrder: 2,
              }),
            }),
          },
          linkPatches: [
            expect.objectContaining({
              operation: {
                kind: 'prependUnique',
                entityKey: 'GraphqlFavorite:document:document-1',
              },
            }),
          ],
        }),
      }
    );
    expect(executeQuery).toHaveBeenCalledTimes(2);
    expect(executeQuery.mock.calls[1]?.[1]).toEqual({
      requestPolicy: 'cache-and-network',
    });
    expect(onSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'document',
        entityId: 'document-1',
      }),
      { entityType: 'document', entityId: 'document-1' },
      undefined
    );
  });

  it('accepts a queued offline favorite change without refetching stale data', async () => {
    executeMutation.mockReturnValue({
      toPromise: async () => ({
        data: {
          setFavorite: {
            __typename: 'SetFavoritePayload' as const,
            result: { __typename: 'GraphqlMutationSuccess' as const },
            favorite: graphqlFavorite('document-3', 2),
          },
        },
        extensions: {
          normalizedCacheMutationDisposition: {
            kind: 'queued',
            transactionId: 'transaction-1',
          },
        },
      }),
    });
    const hooks = renderHook(() => ({
      query: createGraphqlFavoritesQuery(),
      mutation: createGraphqlAddFavoriteMutation(),
    }));

    await vi.waitFor(() => expect(hooks.query.isSuccess).toBe(true));
    const result = await hooks.mutation.mutateAsync({
      entityType: 'document',
      entityId: 'document-3',
    });

    expect(result?.entityId).toBe('document-3');
    expect(executeQuery).toHaveBeenCalledOnce();
  });

  it('queues a cold-cache offline favorite change without an invalid link patch', async () => {
    executeMutation.mockReturnValue({
      toPromise: async () => ({
        data: {
          setFavorite: {
            __typename: 'SetFavoritePayload' as const,
            result: { __typename: 'GraphqlMutationSuccess' as const },
            favorite: graphqlFavorite('document-3', 0),
          },
        },
        extensions: {
          normalizedCacheMutationDisposition: {
            kind: 'queued',
            transactionId: 'transaction-1',
          },
        },
      }),
    });
    const mutation = renderHook(() => createGraphqlAddFavoriteMutation());

    const result = await mutation.mutateAsync({
      entityType: 'document',
      entityId: 'document-3',
    });

    expect(result?.entityId).toBe('document-3');
    expect(executeQuery).not.toHaveBeenCalled();
    expect(executeMutation.mock.calls[0]?.[2]).toEqual({
      normalizedCacheOptimistic: expect.objectContaining({
        linkPatches: [],
      }),
    });
  });
});
