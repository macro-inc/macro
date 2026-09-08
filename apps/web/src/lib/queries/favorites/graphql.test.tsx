import type { Client } from '@urql/core';
import type { JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fromValue } from 'wonka';

const getGraphqlSoupClientMock = vi.hoisted(() => vi.fn());

vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: getGraphqlSoupClientMock,
}));

import {
  createGraphqlFavoritesQuery,
  createGraphqlSetFavoriteMutation,
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
          setEntityFavorite: { __typename: 'GraphqlMutationSuccess' as const },
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
      mutation: createGraphqlSetFavoriteMutation({
        favorite: true,
        onSuccess,
      }),
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
      {}
    );
    expect(executeQuery).toHaveBeenCalledTimes(2);
    expect(executeQuery.mock.calls[1]?.[1]).toEqual({
      requestPolicy: 'network-only',
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
});
