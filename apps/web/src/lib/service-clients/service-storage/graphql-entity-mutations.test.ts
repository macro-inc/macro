import { withOptimisticMutationDisposition } from '@graphql-cache/exchange/optimistic';
import {
  type Client,
  CombinedError,
  createClient,
  type Exchange,
  type Operation,
  type OperationResult,
} from '@urql/core';
import { describe, expect, it, vi } from 'vitest';
import { filter, map, pipe } from 'wonka';

let graphql: Client | undefined;
vi.mock('./graphql-soup', () => ({
  getEntityGraphqlClient: () => {
    if (!graphql) throw new Error('The test must inject a client');
    return graphql;
  },
}));

import { moveGraphqlEntity } from './graphql-entity-mutations';

function replyWith(reply: (operation: Operation) => OperationResult) {
  const exchange: Exchange = () => (operations) =>
    pipe(
      operations,
      filter((operation) => operation.kind !== 'teardown'),
      map(reply)
    );
  graphql = createClient({
    url: 'https://example.test/graphql',
    exchanges: [exchange],
  });
}

describe('entity move transport', () => {
  it('accepts a move the cache queued behind an earlier write', async () => {
    replyWith((operation) =>
      withOptimisticMutationDisposition(
        {
          operation,
          stale: false,
          hasNext: false,
          data: {
            moveEntities: {
              results: [
                {
                  __typename: 'GraphqlMutationSuccess',
                  effects: [
                    {
                      __typename: 'SoupUpdated',
                      item: {
                        __typename: 'GraphqlSoupDocument',
                        id: 'document',
                        projectId: 'folder',
                      },
                    },
                  ],
                },
              ],
            },
          },
        },
        { kind: 'queued', transactionId: 'queued-move' }
      )
    );
    await expect(
      moveGraphqlEntity({
        entity: { type: 'DOCUMENT', id: 'document' },
        projectId: 'folder',
      })
    ).resolves.toMatchObject({ __typename: 'GraphqlMutationSuccess' });
  });

  it('rejects a move the server refused after retries', async () => {
    replyWith((operation) =>
      withOptimisticMutationDisposition(
        {
          operation,
          stale: false,
          hasNext: false,
          error: new CombinedError({
            graphQLErrors: [{ message: 'Forbidden' }],
          }),
        },
        { kind: 'permanently-failed' }
      )
    );
    await expect(
      moveGraphqlEntity({
        entity: { type: 'DOCUMENT', id: 'document' },
        projectId: 'folder',
      })
    ).rejects.toThrow('Forbidden');
  });
});

const input = {
  entity: { type: 'DATABASE' as const, id: 'database-1' },
  projectId: 'folder-1',
};

describe('moveGraphqlEntity', () => {
  it('reports a committed move whose cache patches failed to render', async () => {
    replyWith((operation) => ({
      operation,
      stale: false,
      hasNext: false,
      data: {
        moveEntities: {
          results: [{ __typename: 'GraphqlMutationSuccess', effects: null }],
        },
      },
      error: new CombinedError({
        graphQLErrors: [
          {
            message: 'entity type database is not represented in Soup',
            path: ['moveEntities', 'results', 0, 'effects'],
          },
        ],
      }),
    }));

    await expect(moveGraphqlEntity(input)).resolves.toEqual({
      __typename: 'GraphqlMutationSuccess',
      effects: [],
    });
  });

  it('fails on an error outside the result effects', async () => {
    replyWith((operation) => ({
      operation,
      stale: false,
      hasNext: false,
      data: {
        moveEntities: {
          results: [{ __typename: 'GraphqlMutationSuccess', effects: [] }],
        },
      },
      error: new CombinedError({
        graphQLErrors: [{ message: 'boom', path: ['moveEntities'] }],
      }),
    }));

    await expect(moveGraphqlEntity(input)).rejects.toThrow('boom');
  });

  it('fails on a typed mutation error', async () => {
    replyWith((operation) => ({
      operation,
      stale: false,
      hasNext: false,
      data: {
        moveEntities: {
          results: [
            {
              __typename: 'GraphqlMutationError',
              errorCode: 'FORBIDDEN',
              message: 'insufficient permission for entity mutation',
            },
          ],
        },
      },
    }));

    await expect(moveGraphqlEntity(input)).rejects.toThrow();
  });
});
