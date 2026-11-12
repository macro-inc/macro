import { CombinedError } from '@urql/core';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ mutation: vi.fn() }));

vi.mock('./graphql-soup', () => ({
  getEntityGraphqlClient: () => ({
    mutation: (...args: unknown[]) => ({
      toPromise: () => mocks.mutation(...args),
    }),
  }),
}));

import { moveGraphqlEntity } from './graphql-entity-mutations';

const input = {
  entity: { type: 'DATABASE' as const, id: 'database-1' },
  projectId: 'folder-1',
};

describe('moveGraphqlEntity', () => {
  it('reports a committed move whose cache patches failed to render', async () => {
    mocks.mutation.mockResolvedValue({
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
    });

    await expect(moveGraphqlEntity(input)).resolves.toEqual({
      __typename: 'GraphqlMutationSuccess',
      effects: [],
    });
  });

  it('fails on an error outside the result effects', async () => {
    mocks.mutation.mockResolvedValue({
      data: {
        moveEntities: {
          results: [{ __typename: 'GraphqlMutationSuccess', effects: [] }],
        },
      },
      error: new CombinedError({
        graphQLErrors: [{ message: 'boom', path: ['moveEntities'] }],
      }),
    });

    await expect(moveGraphqlEntity(input)).rejects.toThrow('boom');
  });

  it('fails on a typed mutation error', async () => {
    mocks.mutation.mockResolvedValue({
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
    });

    await expect(moveGraphqlEntity(input)).rejects.toThrow();
  });
});
