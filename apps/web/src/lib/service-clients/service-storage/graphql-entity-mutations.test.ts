import {
  optimisticContextOf,
  withOptimisticMutationDisposition,
} from '@graphql-cache/exchange/optimistic';
import { optimisticResolversExchange } from '@graphql-cache/exchange/optimistic-resolvers';
import { entityOptimisticResolvers } from '@queries/entity-optimistic-resolvers';
import {
  type Client,
  CombinedError,
  createClient,
  type Exchange,
  type Operation,
  type OperationResult,
  stringifyDocument,
} from '@urql/core';
import { describe, expect, it, vi } from 'vitest';
import { filter, map, pipe } from 'wonka';
import { MoveEntitiesDocument } from './graphql/generated/graphql';

let graphql: Client | undefined;
// The cache's result metadata, set by the normalized exchange this test skips.
vi.mock(
  '@graphql-cache/exchange/normalized-cache-exchange',
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    normalizedCacheResultMetadata: (result: OperationResult) =>
      result.extensions?.cacheMetadata,
  })
);
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
      moveGraphqlEntity(
        {
          entity: { type: 'DOCUMENT', id: 'document' },
          projectId: 'folder',
        },
        []
      )
    ).resolves.toMatchObject({
      __typename: 'GraphqlMutationSuccess',
      queued: true,
      effectsResolved: true,
    });
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
      moveGraphqlEntity(
        {
          entity: { type: 'DOCUMENT', id: 'document' },
          projectId: 'folder',
        },
        []
      )
    ).rejects.toThrow('Forbidden');
  });
});

const input = {
  entity: { type: 'DATABASE' as const, id: 'database-1' },
  projectId: 'folder-1',
};

describe('moveGraphqlEntity', () => {
  it('keeps the rows a committed move rendered and reports the rest missing', async () => {
    const rendered = {
      __typename: 'SoupUpdated',
      item: { __typename: 'GraphqlSoupDocument', id: 'document' },
    };
    replyWith((operation) => ({
      operation,
      stale: false,
      hasNext: false,
      data: {
        moveEntities: {
          results: [
            { __typename: 'GraphqlMutationSuccess', effects: [rendered] },
          ],
        },
      },
      error: new CombinedError({
        graphQLErrors: [
          {
            message: 'A changed item could not be read back',
            path: ['moveEntities', 'results', 0, 'effects'],
          },
        ],
      }),
    }));

    await expect(moveGraphqlEntity(input, [])).resolves.toEqual({
      __typename: 'GraphqlMutationSuccess',
      effects: [rendered],
      effectsResolved: false,
      queued: false,
      listsReadAgain: false,
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

    await expect(moveGraphqlEntity(input, [])).rejects.toThrow('boom');
  });

  it('fails on an HTTP 5xx even when its only errors are effects', async () => {
    const error = new CombinedError({
      graphQLErrors: [
        {
          message: 'A changed item could not be read back',
          path: ['moveEntities', 'results', 0, 'effects'],
        },
      ],
      response: new Response(null, { status: 503 }),
    });
    replyWith((operation) => ({
      operation,
      stale: false,
      hasNext: false,
      data: {
        moveEntities: {
          results: [{ __typename: 'GraphqlMutationSuccess', effects: [] }],
        },
      },
      error,
    }));

    await expect(moveGraphqlEntity(input, [])).rejects.toBe(error);
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

    await expect(moveGraphqlEntity(input, [])).rejects.toThrow();
  });
});

describe('revalidations', () => {
  const unmaintained = {
    document: MoveEntitiesDocument,
    variables: { inputs: [] },
  };
  const wire = {
    query: stringifyDocument(MoveEntitiesDocument),
    operationName: 'MoveEntities',
    variablesJson: '{"inputs":[]}',
  };

  function captureRevalidations() {
    const sent: Operation[] = [];
    const capture: Exchange = () => (operations) =>
      pipe(
        operations,
        filter((operation) => operation.kind !== 'teardown'),
        map((operation) => {
          sent.push(operation);
          return {
            operation,
            stale: false,
            hasNext: false,
            data: {
              moveEntities: {
                results: [
                  { __typename: 'GraphqlMutationSuccess', effects: [] },
                ],
              },
            },
          };
        })
      );
    graphql = createClient({
      url: 'https://example.test/graphql',
      exchanges: [
        optimisticResolversExchange(entityOptimisticResolvers),
        capture,
      ],
    });
    return sent;
  }

  it('queues a predicted move with the lists to read again on replay', async () => {
    const sent = captureRevalidations();
    await moveGraphqlEntity(
      { entity: { type: 'DOCUMENT', id: 'document' }, projectId: 'folder' },
      [unmaintained]
    );
    expect(optimisticContextOf(sent[0]!)?.revalidations).toEqual([wire]);
  });
});

it('reports a committed move whose rows the cache failed to apply', async () => {
  replyWith((operation) =>
    withOptimisticMutationDisposition(
      {
        operation,
        stale: false,
        hasNext: false,
        data: {
          moveEntities: {
            results: [{ __typename: 'GraphqlMutationSuccess', effects: [] }],
          },
        },
        extensions: {
          cacheMetadata: { source: 'live-network', cacheEffectsApplied: false },
        },
      },
      { kind: 'committed' }
    )
  );

  await expect(moveGraphqlEntity(input, [])).resolves.toMatchObject({
    effectsResolved: false,
    queued: false,
  });
});
