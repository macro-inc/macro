import { ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReorderFavoritesDocument } from './graphql/generated/graphql';

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

import { reorderFavorites } from './graphql-favorites';

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
          entityType: 'EMAIL_THREAD' as const,
          entityId: 'thread-1',
          sortOrder: 0,
        },
        {
          __typename: 'GraphqlFavorite' as const,
          entityType: 'DOCUMENT' as const,
          entityId: 'document-1',
          sortOrder: 1,
        },
      ],
    },
  };
}

describe('favorites reorder transport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    graphqlSoupEnabledMock.mockReturnValue(true);
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
          revalidations: [],
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
