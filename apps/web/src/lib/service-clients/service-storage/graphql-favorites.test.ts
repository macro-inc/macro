import {
  type Client,
  CombinedError,
  createClient,
  stringifyDocument,
} from '@urql/core';
import { validate as validateUuid } from 'uuid';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FavoritesDocument,
  ReorderFavoritesDocument,
  SetFavoriteDocument,
} from './graphql/generated/graphql';
import {
  executeGraphqlReorderFavoritesMutation,
  executeGraphqlSetFavoriteMutation,
  graphqlReorderFavoritesResult,
  graphqlSetFavoriteResult,
} from './graphql-favorites';

const mutationMock = vi.fn();
const client = {
  mutation: mutationMock,
  createRequestOperation: createClient({ url: 'http://test', exchanges: [] })
    .createRequestOperation,
} as unknown as Client;
const input = { entityType: 'document' as const, entityId: 'document-1' };
const args = {
  favorites: [
    { entityType: 'email_thread' as const, entityId: 'thread-1' },
    input,
  ],
};
const reorderData = {
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
};
const revalidations = [
  {
    query: stringifyDocument(FavoritesDocument),
    operationName: 'Favorites',
    variablesJson: '{}',
  },
];

describe('favorites GraphQL mutations', () => {
  beforeEach(() => {
    mutationMock.mockReset();
    mutationMock.mockReturnValue({
      toPromise: async () => ({ data: reorderData }),
    });
  });

  it.each([
    { favorite: true, patchKind: 'prependUnique' },
    { favorite: false, patchKind: 'remove' },
  ] as const)(
    'submits durable optimism when favorite=$favorite',
    async ({ favorite, patchKind }) => {
      await executeGraphqlSetFavoriteMutation(client, input, favorite, 2);
      expect(mutationMock).toHaveBeenCalledWith(
        SetFavoriteDocument,
        { entity: { type: 'DOCUMENT', id: 'document-1' }, favorite },
        {
          normalizedCacheOptimistic: {
            uuid: expect.any(String),
            optimisticResponse: {
              setFavorite: {
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
            revalidations,
          },
        }
      );
    }
  );

  it('keeps remove and re-add as distinct ordered writes for the same entity', async () => {
    await executeGraphqlSetFavoriteMutation(client, input, false, 0);
    await executeGraphqlSetFavoriteMutation(client, input, true, 2);
    const uuids = mutationMock.mock.calls.map(
      (call) => call[2].normalizedCacheOptimistic.uuid
    );
    expect(uuids.every(validateUuid)).toBe(true);
    expect(new Set(uuids).size).toBe(2);
    expect(mutationMock.mock.calls.map((call) => call[1].favorite)).toEqual([
      false,
      true,
    ]);
  });

  it('submits a complete optimistic reorder and exposes its committed result', async () => {
    const result = await executeGraphqlReorderFavoritesMutation(client, args);
    expect(graphqlReorderFavoritesResult(result)).toEqual({
      kind: 'committed',
    });
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
          optimisticResponse: reorderData,
          linkPatches: [],
          revalidations,
        },
      }
    );
  });

  it('does not let an empty reorder replace an existing queued order', async () => {
    const result = await executeGraphqlReorderFavoritesMutation(client, {
      favorites: [],
    });
    expect(graphqlReorderFavoritesResult(result)).toEqual({
      kind: 'committed',
    });
    expect(mutationMock).not.toHaveBeenCalled();
  });

  it.each(['queued', 'superseded'] as const)(
    'accepts a %s result without requiring stale payload data',
    async (kind) => {
      mutationMock.mockReturnValue({
        toPromise: async () => ({
          extensions: {
            normalizedCacheMutationDisposition: {
              kind,
              transactionId: 'transaction-1',
              replacementTransactionId: 'transaction-2',
            },
          },
        }),
      });
      const result = await executeGraphqlReorderFavoritesMutation(client, args);
      expect(graphqlReorderFavoritesResult(result)).toEqual({
        kind: 'queued',
        transactionId: kind === 'queued' ? 'transaction-1' : 'transaction-2',
      });
      const toggle = await executeGraphqlSetFavoriteMutation(
        client,
        input,
        true,
        2
      );
      expect(graphqlSetFavoriteResult(toggle)).toBeUndefined();
    }
  );

  it('rejects permanent transport failures for both mutation types', async () => {
    const error = new CombinedError({
      graphQLErrors: [new Error('not authorized')],
    });
    mutationMock.mockReturnValue({
      toPromise: async () => ({
        error,
        extensions: {
          normalizedCacheMutationDisposition: { kind: 'permanently-failed' },
        },
      }),
    });
    const reorder = await executeGraphqlReorderFavoritesMutation(client, args);
    const toggle = await executeGraphqlSetFavoriteMutation(
      client,
      input,
      true,
      0
    );
    expect(() => graphqlReorderFavoritesResult(reorder)).toThrow(error);
    expect(() => graphqlSetFavoriteResult(toggle)).toThrow(error);
  });
});
