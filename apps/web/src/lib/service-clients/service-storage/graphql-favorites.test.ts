import { stringifyDocument } from '@urql/core';
import { ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FavoritesDocument,
  ReorderFavoritesDocument,
  SetFavoriteDocument,
} from './graphql/generated/graphql';

const { graphqlSoupEnabledMock, mutationMock, reorderFavoritesRestMock } =
  vi.hoisted(() => ({
    graphqlSoupEnabledMock: vi.fn(() => true),
    mutationMock: vi.fn(),
    reorderFavoritesRestMock: vi.fn(),
  }));

vi.mock('@core/constant/featureFlags', () => ({
  enableGraphqlSoup: { key: 'enable-graphql-soup' },
  isFeatureEnabled: graphqlSoupEnabledMock,
}));

vi.mock('./client', () => ({
  storageServiceClient: {
    favorites: { reorderFavorites: reorderFavoritesRestMock },
  },
}));

vi.mock('./graphql-soup', () => ({
  getGraphqlSoupClient: () => ({ mutation: mutationMock }),
}));

import {
  executeGraphqlSetFavoriteMutation,
  reorderFavorites,
  setFavoriteOptimisticMutationUuid,
} from './graphql-favorites';

const args = {
  favorites: [
    { entityType: 'email_thread' as const, entityId: 'thread-1' },
    { entityType: 'document' as const, entityId: 'document-1' },
  ],
};

function committedGraphqlResponse() {
  return {
    data: {
      reorderFavorites: [
        {
          __typename: 'GraphqlFavorite' as const,
          id: 'email_thread:thread-1',
          entityType: 'EMAIL_THREAD' as const,
          entityId: 'thread-1',
          sortOrder: 0,
        },
        {
          __typename: 'GraphqlFavorite' as const,
          id: 'document:document-1',
          entityType: 'DOCUMENT' as const,
          entityId: 'document-1',
          sortOrder: 1,
        },
      ],
    },
  };
}

describe('favorites GraphQL mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    graphqlSoupEnabledMock.mockReturnValue(true);
  });

  it.each([
    { favorite: true, patchKind: 'prependUnique' },
    { favorite: false, patchKind: 'remove' },
  ] as const)(
    'submits a durable optimistic set mutation when favorite=$favorite',
    async ({ favorite, patchKind }) => {
      mutationMock.mockReturnValue({
        toPromise: async () => ({
          data: {
            setEntityFavorite: {
              __typename: 'SetFavoritePayload',
              result: { __typename: 'GraphqlMutationSuccess' },
              favorite: null,
            },
          },
        }),
      });
      const input = {
        entityType: 'document' as const,
        entityId: 'document-1',
      };

      await executeGraphqlSetFavoriteMutation(
        { mutation: mutationMock } as never,
        input,
        favorite,
        2
      );

      expect(mutationMock).toHaveBeenCalledWith(
        SetFavoriteDocument,
        {
          entity: { type: 'DOCUMENT', id: 'document-1' },
          favorite,
        },
        {
          normalizedCacheOptimistic: {
            uuid: setFavoriteOptimisticMutationUuid(input),
            optimisticResponse: {
              setEntityFavorite: {
                __typename: 'SetFavoritePayload',
                result: { __typename: 'GraphqlMutationSuccess' },
                favorite: favorite
                  ? expect.objectContaining({
                      __typename: 'GraphqlFavorite',
                      id: 'document:document-1',
                      entityType: 'DOCUMENT',
                      entityId: 'document-1',
                      sortOrder: 2,
                    })
                  : null,
              },
            },
            linkPatches: [
              {
                query: stringifyDocument(FavoritesDocument),
                operationName: 'Favorites',
                variablesJson: '{}',
                path: [{ field: 'user' }, { field: 'favorites' }],
                operation: {
                  kind: patchKind,
                  entityKey: 'GraphqlFavorite:document:document-1',
                },
              },
            ],
            revalidations: [
              {
                query: stringifyDocument(FavoritesDocument),
                operationName: 'Favorites',
                variablesJson: '{}',
              },
            ],
          },
        }
      );
    }
  );

  it('coalesces newer offline favorite state for the same entity only', () => {
    const document = {
      entityType: 'document' as const,
      entityId: 'document-1',
    };

    expect(setFavoriteOptimisticMutationUuid(document)).toBe(
      setFavoriteOptimisticMutationUuid(document)
    );
    expect(setFavoriteOptimisticMutationUuid(document)).not.toBe(
      setFavoriteOptimisticMutationUuid({
        ...document,
        entityId: 'document-2',
      })
    );
  });

  it('uses REST while GraphQL Soup is disabled', async () => {
    graphqlSoupEnabledMock.mockReturnValue(false);
    reorderFavoritesRestMock.mockResolvedValue(ok(undefined));

    await expect(reorderFavorites(args)).resolves.toEqual({
      kind: 'committed',
    });

    expect(reorderFavoritesRestMock).toHaveBeenCalledWith(args);
    expect(mutationMock).not.toHaveBeenCalled();
  });

  it('uses the GraphQL mutation with a complete optimistic order when enabled', async () => {
    mutationMock.mockReturnValue({
      toPromise: async () => committedGraphqlResponse(),
    });

    await expect(reorderFavorites(args)).resolves.toEqual({
      kind: 'committed',
    });

    expect(reorderFavoritesRestMock).not.toHaveBeenCalled();
    expect(mutationMock).toHaveBeenCalledWith(
      ReorderFavoritesDocument,
      {
        input: {
          favorites: [
            { type: 'EMAIL_THREAD', id: 'thread-1' },
            { type: 'DOCUMENT', id: 'document-1' },
          ],
        },
      },
      {
        normalizedCacheOptimistic: {
          uuid: '86cc4bfe-c45a-4e28-880a-6ba5ca921d35',
          optimisticResponse: committedGraphqlResponse().data,
          linkPatches: [],
          revalidations: [
            {
              query: stringifyDocument(FavoritesDocument),
              operationName: 'Favorites',
              variablesJson: '{}',
            },
          ],
        },
      }
    );
  });

  it('treats an offline queued GraphQL reorder as accepted', async () => {
    mutationMock.mockReturnValue({
      toPromise: async () => ({
        extensions: {
          normalizedCacheMutationDisposition: {
            kind: 'queued',
            transactionId: 'transaction-1',
          },
        },
      }),
    });

    await expect(reorderFavorites(args)).resolves.toEqual({
      kind: 'queued',
      transactionId: 'transaction-1',
    });
    expect(reorderFavoritesRestMock).not.toHaveBeenCalled();
  });
});
