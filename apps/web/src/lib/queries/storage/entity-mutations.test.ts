import { withOptimisticMutationDisposition } from '@graphql-cache/exchange/optimistic';
import { CombinedError } from '@urql/core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  mutation: vi.fn(),
  refresh: vi.fn(),
  host: vi.fn(),
  unmaintained: vi.fn(),
  readAgain: vi.fn(),
}));
vi.mock('@graphql-cache/exchange/network-revalidation-exchange', () => ({
  networkRevalidated: mocks.readAgain,
}));
vi.mock('@service-storage/graphql-soup', () => ({
  getEntityGraphqlClient: () => ({ mutation: mocks.mutation }),
  getGraphqlCacheHost: mocks.host,
}));
vi.mock('../soup/graphql/active-queries', () => ({
  refreshActiveGraphqlSoupQueries: mocks.refresh,
  getUnmaintainedGraphqlSoupRevalidations: mocks.unmaintained,
}));
vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return { queryClient: new QueryClient() };
});

import { UpdateEntitySharePoliciesDocument } from '@service-storage/graphql/generated/graphql';
import { queryClient } from '../client';
import { createGraphqlSoupDeletion } from '../soup/graphql/optimistic-deletions';

const UNMAINTAINED = [{ document: 'unmaintained-list', variables: {} }];

import {
  duplicateEntity,
  moveEntity,
  restoreEntity,
  trashEntity,
  updateEntitySharePolicy,
  usesGraphqlSharePolicy,
} from './entity-mutations';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.refresh.mockResolvedValue(undefined);
  mocks.host.mockReturnValue({ disabled: false });
  mocks.unmaintained.mockReturnValue(UNMAINTAINED);
  mocks.readAgain.mockReturnValue(false);
  mocks.mutation.mockReturnValue({
    toPromise: async () => ({
      data: {
        updateEntitySharePolicies: {
          results: [
            {
              __typename: 'GraphqlMutationSuccess',
              effects: [],
            },
          ],
        },
      },
    }),
  });
});

afterEach(() => queryClient.clear());

/** A move the cache queued, answered with its prediction. */
const queuedMove = () =>
  withOptimisticMutationDisposition(
    {
      operation: { context: {} },
      data: {
        moveEntities: {
          results: [{ __typename: 'GraphqlMutationSuccess', effects: [] }],
        },
      },
    } as never,
    { kind: 'queued', transactionId: 'move' }
  );

const trashed = (effects: unknown) => ({
  toPromise: async () => ({
    data: {
      trashEntities: {
        results: [{ __typename: 'GraphqlMutationSuccess', effects }],
      },
    },
    error:
      effects === null
        ? new CombinedError({
            graphQLErrors: [
              {
                message: 'effects',
                path: ['trashEntities', 'results', 0, 'effects'],
              },
            ],
          })
        : undefined,
  }),
});

it('reads only the lists the cache cannot keep current after a write', async () => {
  mocks.mutation.mockReturnValue(trashed([]));
  await trashEntity({ type: 'DOCUMENT', id: 'entity' });
  expect(mocks.refresh).toHaveBeenCalledExactlyOnceWith({
    unmaintainedOnly: true,
  });
});

it('uses the accepted tombstone and reads only unmaintained lists', async () => {
  mocks.mutation.mockReturnValue({
    toPromise: async () => ({
      ...(await trashed([
        {
          __typename: 'GraphqlCacheDeletion',
          graphqlTypeName: 'GraphqlSoupDocument',
          entityId: 'entity',
        },
      ]).toPromise()),
      extensions: {
        __macroNormalizedCache: {
          source: 'live-network',
          cacheEffectsApplied: true,
        },
      },
    }),
  });
  const acknowledge = vi.fn<(ready: Promise<boolean>) => void>();
  await trashEntity({ type: 'DOCUMENT', id: 'entity' }, acknowledge);
  expect(acknowledge).toHaveBeenCalledOnce();
  await expect(acknowledge.mock.calls[0]?.[0]).resolves.toBe(true);
  expect(mocks.refresh).toHaveBeenCalledExactlyOnceWith({
    unmaintainedOnly: true,
  });
});

it('uses the completed uncached exchange read as the deletion acknowledgement', async () => {
  mocks.host.mockReturnValue(undefined);
  mocks.readAgain.mockReturnValue(true);
  mocks.mutation.mockReturnValue(trashed([]));
  const acknowledge = vi.fn<(ready: Promise<boolean>) => void>();
  await trashEntity({ type: 'DOCUMENT', id: 'entity' }, acknowledge);
  expect(acknowledge).toHaveBeenCalledOnce();
  await expect(acknowledge.mock.calls[0]?.[0]).resolves.toBe(true);
  expect(mocks.refresh).not.toHaveBeenCalled();
});

it('keeps a deletion unacknowledged when both cache effects and recovery fail', async () => {
  mocks.mutation.mockReturnValue(trashed([]));
  mocks.refresh.mockRejectedValue(new Error('list read failed'));
  const acknowledge = vi.fn<(ready: Promise<boolean>) => void>();
  await trashEntity({ type: 'DOCUMENT', id: 'entity' }, acknowledge);
  expect(acknowledge).toHaveBeenCalledOnce();
  await expect(acknowledge.mock.calls[0]?.[0]).resolves.toBe(false);
  expect(mocks.refresh).toHaveBeenCalledExactlyOnceWith({
    unmaintainedOnly: false,
    throwOnError: true,
  });
});

it('recovers a delete whose transport lost the server reply without retrying the write', async () => {
  const error = new CombinedError({
    networkError: new Error('connection lost'),
  });
  mocks.mutation.mockReturnValue({ toPromise: async () => ({ error }) });
  const acknowledge = vi.fn();
  await expect(
    trashEntity({ type: 'PROJECT', id: 'entity' }, acknowledge)
  ).rejects.toBe(error);
  expect(acknowledge).not.toHaveBeenCalled();
  expect(mocks.mutation).toHaveBeenCalledOnce();
  expect(mocks.refresh).toHaveBeenCalledExactlyOnceWith({
    unmaintainedOnly: false,
  });
});

it('leaves the lists to the client when its exchange read them all', async () => {
  // Without a live cache the exchange read every mounted list, each
  // successfully, before the write settled.
  mocks.host.mockReturnValue(undefined);
  mocks.readAgain.mockReturnValue(true);
  mocks.mutation.mockReturnValue(trashed([]));
  await trashEntity({ type: 'DOCUMENT', id: 'entity' });
  expect(mocks.refresh).not.toHaveBeenCalled();
});

it.each([
  ['a live cache', { disabled: false }],
  ['no live cache', undefined],
])(
  'reads every list after a write whose rows never came back, with %s',
  async (_, host) => {
    mocks.host.mockReturnValue(host);
    mocks.mutation.mockReturnValue(trashed(null));
    await trashEntity({ type: 'DOCUMENT', id: 'entity' });
    expect(mocks.refresh).toHaveBeenCalledExactlyOnceWith({
      unmaintainedOnly: false,
    });
  }
);

it('queues a move with the lists to read once it commits, and reads none itself', async () => {
  mocks.mutation.mockReturnValue({
    toPromise: async () => ({
      ...queuedMove(),
    }),
  });
  await moveEntity({ type: 'DOCUMENT', id: 'entity' }, 'project');
  expect(mocks.mutation.mock.calls[0]?.[2]).toEqual({
    macroTraceParent: expect.anything(),
    optimisticMutation: { revalidations: UNMAINTAINED },
  });
  expect(mocks.refresh).not.toHaveBeenCalled();
});

it('shows a confirmed restore immediately while retaining unrelated and newer deletes', async () => {
  mocks.refresh.mockReturnValue(new Promise<void>(() => {}));
  const earlier = createGraphqlSoupDeletion([
    'GraphqlSoupDocument:restored',
    'GraphqlSoupDocument:sibling',
    'GraphqlSoupChat:restored',
  ]);
  earlier.settle(earlier.keys());
  let finish!: () => void;
  const network = new Promise<void>((resolve) => {
    finish = resolve;
  });
  mocks.mutation.mockReturnValue({
    toPromise: async () => {
      await network;
      return {
        data: {
          restoreEntities: {
            results: [
              {
                __typename: 'GraphqlMutationSuccess',
                effects: [
                  {
                    __typename: 'SoupUpdated',
                    item: { __typename: 'GraphqlSoupDocument', id: 'restored' },
                  },
                ],
              },
            ],
          },
        },
      };
    },
  });
  const restore = restoreEntity({ type: 'DOCUMENT', id: 'restored' });
  const newer = createGraphqlSoupDeletion(['GraphqlSoupDocument:restored']);
  newer.settle(['GraphqlSoupDocument:restored']);
  try {
    finish();
    await restore;
    expect(earlier.keys()).toEqual([
      'GraphqlSoupDocument:sibling',
      'GraphqlSoupChat:restored',
    ]);
    expect(newer.keys()).toEqual(['GraphqlSoupDocument:restored']);
  } finally {
    earlier.release();
    newer.release();
  }
});

it('shows the restored rows the server returned when another could not be read back', async () => {
  mocks.refresh.mockReturnValue(new Promise<void>(() => {}));
  const deletion = createGraphqlSoupDeletion([
    'GraphqlSoupProject:restored',
    'GraphqlSoupDocument:child',
    'GraphqlSoupDocument:unreadable',
  ]);
  deletion.settle(deletion.keys());
  mocks.mutation.mockReturnValue({
    toPromise: async () => ({
      data: {
        restoreEntities: {
          results: [
            {
              __typename: 'GraphqlMutationSuccess',
              effects: [
                {
                  __typename: 'SoupUpdated',
                  item: { __typename: 'GraphqlSoupDocument', id: 'child' },
                },
              ],
            },
          ],
        },
      },
      error: new CombinedError({
        graphQLErrors: [
          {
            message: 'A changed item could not be read back',
            path: ['restoreEntities', 'results', 0, 'effects'],
          },
        ],
      }),
    }),
  });
  try {
    await restoreEntity({ type: 'PROJECT', id: 'restored' });
    expect(deletion.keys()).toEqual(['GraphqlSoupDocument:unreadable']);
    expect(mocks.refresh).toHaveBeenCalledWith({
      unmaintainedOnly: false,
    });
  } finally {
    deletion.release();
  }
});

it('keeps prior deletion markers when the server refuses restoration', async () => {
  mocks.refresh.mockReturnValue(new Promise<void>(() => {}));
  const deletion = createGraphqlSoupDeletion(['GraphqlSoupDocument:deleted']);
  deletion.settle(['GraphqlSoupDocument:deleted']);
  mocks.mutation.mockReturnValue({
    toPromise: async () => ({
      data: {
        restoreEntities: {
          results: [
            {
              __typename: 'GraphqlMutationError',
              errorCode: 'FORBIDDEN',
              message: 'Denied',
            },
          ],
        },
      },
    }),
  });
  try {
    await expect(
      restoreEntity({ type: 'DOCUMENT', id: 'deleted' })
    ).rejects.toBeDefined();
    expect(deletion.keys()).toEqual(['GraphqlSoupDocument:deleted']);
  } finally {
    deletion.release();
  }
});

it.each([
  ['document', 'DOCUMENT'],
  ['chat', 'CHAT'],
  ['project', 'PROJECT'],
  ['email', 'EMAIL_THREAD'],
  ['call', 'CALL'],
] as const)(
  'updates %s permissions with enum translation and explicit revocation',
  async (type, gqlType) => {
    const result = await updateEntitySharePolicy(type, 'entity', {
      linkShare: null,
      linkShareAccessLevel: null,
      teamShareAccessLevel: 'view',
      channelSharePermissions: [
        { operation: 'add', channelId: 'a', accessLevel: 'view' },
        { operation: 'replace', channelId: 'b', accessLevel: 'edit' },
        { operation: 'remove', channelId: 'c' },
      ],
    });
    expect(result.isOk()).toBe(true);
    expect(mocks.mutation).toHaveBeenCalledWith(
      UpdateEntitySharePoliciesDocument,
      {
        inputs: [
          {
            entity: { type: gqlType, id: 'entity' },
            policy: {
              linkShare: null,
              linkShareAccessLevel: null,
              teamShareAccessLevel: 'VIEW',
              channelSharePermissions: [
                { operation: 'ADD', channelId: 'a', accessLevel: 'VIEW' },
                { operation: 'REPLACE', channelId: 'b', accessLevel: 'EDIT' },
                { operation: 'REMOVE', channelId: 'c', accessLevel: undefined },
              ],
            },
          },
        ],
      },
      // The request and cache writes join the `entity.*` span's trace.
      { macroTraceParent: expect.anything() }
    );
    expect(mocks.refresh).toHaveBeenCalledExactlyOnceWith({
      unmaintainedOnly: true,
    });
  }
);

it('leaves omitted sharing fields absent on the wire', async () => {
  await updateEntitySharePolicy('document', 'entity', {
    teamShareAccessLevel: null,
  });
  expect(JSON.parse(JSON.stringify(mocks.mutation.mock.calls[0][1]))).toEqual({
    inputs: [
      {
        entity: { type: 'DOCUMENT', id: 'entity' },
        policy: { teamShareAccessLevel: null },
      },
    ],
  });
});

it('excludes unsupported kinds from the GraphQL share policy', () => {
  expect(usesGraphqlSharePolicy('document')).toBe(true);
  for (const kind of [
    'agent_session',
    'initiative',
    'database',
    'form',
    'crm_pipeline',
    'channel',
  ])
    expect(usesGraphqlSharePolicy(kind)).toBe(false);
});

it.each([
  {},
  { data: { moveEntities: { results: [] } } },
  {
    data: {
      moveEntities: {
        results: [
          {
            __typename: 'GraphqlMutationError',
            errorCode: 'NOT_FOUND',
            message: 'Missing',
          },
        ],
      },
    },
  },
  { error: new CombinedError({ networkError: new Error('Connection lost') }) },
])(
  'rejects missing or failed results without refreshing: %j',
  async (response) => {
    mocks.mutation.mockReturnValue({ toPromise: async () => response });
    await expect(
      moveEntity({ type: 'DOCUMENT', id: 'entity' }, null)
    ).rejects.toBeDefined();
    expect(mocks.mutation).toHaveBeenCalledOnce();
    expect(mocks.refresh).not.toHaveBeenCalled();
  }
);

it('preserves a sharing domain refusal as a failed result', async () => {
  mocks.mutation.mockReturnValue({
    toPromise: async () => ({
      data: {
        updateEntitySharePolicies: {
          results: [
            {
              __typename: 'GraphqlMutationError',
              errorCode: 'FORBIDDEN',
              message: 'Denied',
            },
          ],
        },
      },
    }),
  });
  const result = await updateEntitySharePolicy('document', 'entity', {
    teamShareAccessLevel: 'edit',
  });
  expect(result.isErr() && result.error).toEqual([
    { code: 'FORBIDDEN', message: 'Denied' },
  ]);
  expect(mocks.refresh).not.toHaveBeenCalled();
});

it('never mistakes a source or parent patch for the duplicated entity', async () => {
  mocks.mutation.mockReturnValue({
    toPromise: async () => ({
      data: {
        duplicateEntities: {
          results: [
            {
              __typename: 'GraphqlMutationSuccess',
              effects: [
                {
                  __typename: 'SoupUpdated',
                  item: { __typename: 'GraphqlSoupProject', id: 'parent' },
                },
                {
                  __typename: 'SoupUpdated',
                  item: { __typename: 'GraphqlSoupDocument', id: 'source' },
                },
              ],
            },
          ],
        },
      },
    }),
  });
  await expect(
    duplicateEntity({ type: 'DOCUMENT', id: 'source' })
  ).rejects.toThrow('no copy identity');
  expect(mocks.mutation).toHaveBeenCalledOnce();
});

it.each([
  [
    'trash',
    () => trashEntity({ type: 'DOCUMENT', id: 'entity' }),
    'trashEntities',
  ],
  [
    'move',
    () => moveEntity({ type: 'DOCUMENT', id: 'entity' }, 'project'),
    'moveEntities',
  ],
])(
  'reads every list in its own order when the exchange could not, after a %s without a live cache',
  async (_, write, field) => {
    mocks.host.mockReturnValue(undefined);
    mocks.readAgain.mockReturnValue(false);
    mocks.mutation.mockReturnValue({
      toPromise: async () => ({
        data: {
          [field]: {
            results: [{ __typename: 'GraphqlMutationSuccess', effects: [] }],
          },
        },
      }),
    });
    await write();
    expect(mocks.refresh).toHaveBeenCalledExactlyOnceWith({
      unmaintainedOnly: false,
    });
  }
);

it('reads the lists itself after a move the queue refused and sent directly', async () => {
  mocks.mutation.mockReturnValue({
    toPromise: async () =>
      withOptimisticMutationDisposition(
        {
          operation: { context: {} },
          data: {
            moveEntities: {
              results: [{ __typename: 'GraphqlMutationSuccess', effects: [] }],
            },
          },
        } as never,
        { kind: 'committed' }
      ),
  });
  await moveEntity({ type: 'DOCUMENT', id: 'entity' }, 'project');
  expect(mocks.refresh).toHaveBeenCalledExactlyOnceWith({
    unmaintainedOnly: true,
  });
});
