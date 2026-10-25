import { CombinedError } from '@urql/core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  graphql: true,
  mutation: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('@core/constant/featureFlags', () => ({
  enableGraphqlSoup: {},
  isFeatureEnabled: () => mocks.graphql,
}));
vi.mock('@service-storage/graphql-soup', () => ({
  getEntityGraphqlClient: () => ({ mutation: mocks.mutation }),
}));
vi.mock('../soup/graphql/active-queries', () => ({
  refreshActiveGraphqlSoupQueries: mocks.refresh,
}));
vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return { queryClient: new QueryClient() };
});

import { UpdateEntitySharePoliciesDocument } from '@service-storage/graphql/generated/graphql';
import { queryClient } from '../client';
import { createGraphqlSoupDeletion } from '../soup/graphql/optimistic-deletions';
import {
  duplicateEntity,
  moveEntity,
  restoreEntity,
  updateEntitySharePolicy,
  usesGraphqlSharePolicy,
} from './entity-mutations';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.graphql = true;
  mocks.refresh.mockResolvedValue(undefined);
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

it('shows a confirmed restore immediately while retaining unrelated and newer deletes', async () => {
  mocks.refresh.mockReturnValue(new Promise<void>(() => {}));
  const earlier = createGraphqlSoupDeletion(['restored', 'sibling']);
  earlier.settle(['restored', 'sibling']);
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
  const newer = createGraphqlSoupDeletion(['restored']);
  newer.settle(['restored']);
  try {
    finish();
    await restore;
    expect(earlier.ids()).toEqual(['sibling']);
    expect(newer.ids()).toEqual(['restored']);
  } finally {
    earlier.release();
    newer.release();
  }
});

it('keeps prior deletion markers when the server refuses restoration', async () => {
  mocks.refresh.mockReturnValue(new Promise<void>(() => {}));
  const deletion = createGraphqlSoupDeletion(['deleted']);
  deletion.settle(['deleted']);
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
    expect(deletion.ids()).toEqual(['deleted']);
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
      }
    );
    expect(mocks.refresh).toHaveBeenCalledOnce();
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

it('reads the rollout flag at invocation and excludes unsupported kinds', () => {
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
  mocks.graphql = false;
  expect(usesGraphqlSharePolicy('document')).toBe(false);
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
