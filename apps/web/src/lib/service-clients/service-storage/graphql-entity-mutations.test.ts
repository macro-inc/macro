import { networkRevalidationExchange } from '@graphql-cache/exchange/network-revalidation-exchange';
import {
  optimisticContextOf,
  withOptimisticMutationDisposition,
} from '@graphql-cache/exchange/optimistic';
import { optimisticResolversExchange } from '@graphql-cache/exchange/optimistic-resolvers';
import type { CacheHost } from '@graphql-cache/host/types';
import { entityOptimisticResolvers } from '@queries/entity-optimistic-resolvers';
import {
  type Client,
  CombinedError,
  createClient,
  type Exchange,
  getOperationName,
  gql,
  type Operation,
  type OperationResult,
  stringifyDocument,
} from '@urql/core';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { filter, map, pipe } from 'wonka';
import { MoveEntitiesDocument } from './graphql/generated/graphql';

let graphql: Client | undefined;
const [cacheHost, setCacheHost] = createSignal<CacheHost>();
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
  getGraphqlCacheHost: () => {
    const host = cacheHost();
    return host?.disabled ? undefined : host;
  },
  getEntityGraphqlClient: () => {
    if (!graphql) throw new Error('The test must inject a client');
    return graphql;
  },
}));

import {
  moveGraphqlEntity,
  setGraphqlEntityAppearance,
} from './graphql-entity-mutations';

afterEach(() => {
  setCacheHost(undefined);
});

function replyWith(
  reply: (operation: Operation) => OperationResult,
  exchanges: Exchange[] = []
) {
  const exchange: Exchange = () => (operations) =>
    pipe(
      operations,
      filter((operation) => operation.kind !== 'teardown'),
      map(reply)
    );
  graphql = createClient({
    url: 'https://example.test/graphql',
    exchanges: [...exchanges, exchange],
  });
  return graphql;
}

describe('entity appearance transport', () => {
  const input = {
    entity: { type: 'DOCUMENT', id: 'document' },
    color: 'GREEN',
  } as const;

  it('reports an older server schema refusal for a direct write', async () => {
    const reply = vi.fn(
      (operation: Operation): OperationResult => ({
        operation,
        stale: false,
        hasNext: false,
        error: new CombinedError({
          graphQLErrors: [
            { message: 'Unknown type "SetEntityAppearanceInput"' },
            {
              message:
                'Unknown field "setEntityAppearance" on type "CompleteMutationRoot".',
            },
          ],
        }),
      })
    );
    replyWith(reply);
    await expect(
      setGraphqlEntityAppearance(input, [], () => true)
    ).rejects.toThrow('Unknown type "SetEntityAppearanceInput"');
    expect(reply).toHaveBeenCalledOnce();
  });

  it('reads only the affected row when a live write commits without effects', async () => {
    const reply = vi.fn(
      (operation: Operation): OperationResult => ({
        operation,
        stale: false,
        hasNext: false,
        data:
          operation.kind === 'mutation'
            ? { setEntityAppearance: { effects: [] } }
            : { user: { id: 'viewer', soupEntity: null } },
        error:
          operation.kind === 'mutation'
            ? new CombinedError({
                graphQLErrors: [
                  {
                    message: 'A changed item could not be read back',
                    path: ['setEntityAppearance', 'effects'],
                  },
                ],
              })
            : undefined,
      })
    );
    replyWith(reply);
    await expect(
      setGraphqlEntityAppearance(input, [], () => true)
    ).resolves.toMatchObject({ queued: false });
    expect(reply).toHaveBeenCalledTimes(2);
    const lookup = reply.mock.calls[1][0];
    expect(stringifyDocument(lookup.query)).toContain('soupEntity(input:');
    expect(lookup).toMatchObject({
      kind: 'query',
      context: { requestPolicy: 'network-only' },
      variables: {
        input: { entityType: 'DOCUMENT', entityId: 'document' },
      },
    });
  });

  it('rereads a mounted uncached list when the write commits without effects', async () => {
    const list = gql`query AppearanceList { items { id appearance } }`;
    let appearance = 'GRAY';
    const reply = vi.fn((operation: Operation): OperationResult => {
      const result = { operation, stale: false, hasNext: false };
      if (operation.kind === 'mutation') {
        appearance = 'GREEN';
        return {
          ...result,
          data: { setEntityAppearance: { effects: [] } },
          error: new CombinedError({
            graphQLErrors: [
              {
                message: 'A changed item could not be read back',
                path: ['setEntityAppearance', 'effects'],
              },
            ],
          }),
        };
      }
      return { ...result, data: { items: [{ id: 'document', appearance }] } };
    });
    const client = replyWith(reply, [networkRevalidationExchange(() => true)]);
    const received: Array<string | undefined> = [];
    const mounted = client
      .query<{ items: Array<{ appearance: string }> }>(list, {})
      .subscribe(({ data }) => received.push(data?.items[0]?.appearance));
    try {
      expect(received).toEqual(['GRAY']);
      await expect(
        setGraphqlEntityAppearance(input, [], () => true)
      ).resolves.toMatchObject({ queued: false, listsReadAgain: true });
      expect(received).toEqual(['GRAY', 'GREEN']);
      expect(
        reply.mock.calls.map(([operation]) => getOperationName(operation.query))
      ).toEqual(['AppearanceList', 'SetEntityAppearance', 'AppearanceList']);
    } finally {
      mounted.unsubscribe();
    }
  });

  it('uses the queue recovery when a durable write commits without effects', async () => {
    const reply = vi.fn((operation: Operation) =>
      withOptimisticMutationDisposition(
        {
          operation,
          stale: false,
          hasNext: false,
          data: { setEntityAppearance: { effects: [] } },
        },
        { kind: 'committed', transactionId: 'queued-appearance' }
      )
    );
    replyWith(reply);
    await expect(
      setGraphqlEntityAppearance(input, [], () => true)
    ).resolves.toMatchObject({ queued: false });
    expect(reply).toHaveBeenCalledOnce();
  });

  it('acknowledges a durable queue without response data and releases its retired host', async () => {
    const stopSettlements = vi.fn();
    const stopGeneration = vi.fn();
    setCacheHost({
      onMutationSettled: () => stopSettlements,
      onCacheGenerationChanged: () => stopGeneration,
    } as unknown as CacheHost);
    replyWith((operation) =>
      withOptimisticMutationDisposition(
        { operation, stale: false, hasNext: false },
        { kind: 'queued', transactionId: 'queued-appearance' }
      )
    );
    const receipt = await setGraphqlEntityAppearance(input, [], () => true);
    expect(receipt.queued).toBe(true);
    expect(receipt.settlement).toBeInstanceOf(Promise);
    setCacheHost(undefined);
    await expect(receipt.settlement).resolves.toBeUndefined();
    expect(stopSettlements).toHaveBeenCalledOnce();
    expect(stopGeneration).toHaveBeenCalledOnce();
  });

  it('keeps a queued save observable when the same host pauses and resumes', async () => {
    const [paused, setPaused] = createSignal(false);
    const stopSettlements = vi.fn();
    const subscribe = vi.fn<CacheHost['onMutationSettled']>(
      () => stopSettlements
    );
    setCacheHost({
      get paused() {
        return paused();
      },
      get disabled() {
        return paused();
      },
      onMutationSettled: subscribe,
      onCacheGenerationChanged: () => () => {},
    } as unknown as CacheHost);
    const reply = vi.fn((operation: Operation) =>
      withOptimisticMutationDisposition(
        { operation, stale: false, hasNext: false },
        { kind: 'queued', transactionId: 'queued-appearance' }
      )
    );
    replyWith(reply);
    const receipt = await setGraphqlEntityAppearance(input, [], () => true);
    expect(receipt.queued).toBe(true);
    setPaused(true);
    expect(stopSettlements).not.toHaveBeenCalled();
    setPaused(false);
    const { uuid } = reply.mock.calls[0][0].context.optimisticMutation as {
      uuid: string;
    };
    subscribe.mock.calls[0][0]({
      mutationUuid: uuid,
      transactionId: 'queued-appearance',
      status: 'committed',
    });
    await expect(receipt.settlement).resolves.toBe('committed');
    expect(stopSettlements).toHaveBeenCalledOnce();
  });
});

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
