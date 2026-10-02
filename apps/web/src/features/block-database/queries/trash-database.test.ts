import { CombinedError } from '@urql/core';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type TrashDatabaseClient, trashDatabase } from './trash-database';

const cache = vi.hoisted(() => ({
  setQueryData: vi.fn(),
  invalidateQueries: vi.fn(),
}));
vi.mock('@queries/client', () => ({ queryClient: cache }));
beforeEach(() => vi.clearAllMocks());

describe('trash database', () => {
  it('trashes the database entity and removes only it from the cached list', async () => {
    const mutation = vi.fn<TrashDatabaseClient['mutation']>(() => ({
      toPromise: async () => ({
        data: {
          trashEntities: {
            results: [{ __typename: 'GraphqlMutationSuccess' }],
          },
        },
      }),
    }));

    expect(await trashDatabase({ mutation }, 'db')).toEqual(ok(undefined));

    expect(mutation.mock.calls[0][1]).toEqual({ id: 'db' });
    const update = cache.setQueryData.mock.calls[0][1];
    expect(
      update([{ database: { id: 'db' } }, { database: { id: 'other' } }])
    ).toEqual([{ database: { id: 'other' } }]);
    expect(cache.invalidateQueries).toHaveBeenCalledTimes(2);
  });

  it('carries the refusal code and leaves the cache intact', async () => {
    const client: TrashDatabaseClient = {
      mutation: () => ({
        toPromise: async () => ({
          data: {
            trashEntities: {
              results: [
                {
                  __typename: 'GraphqlMutationError',
                  errorCode: 'FORBIDDEN',
                  message: 'Owner access required',
                },
              ],
            },
          },
        }),
      }),
    };

    expect(await trashDatabase(client, 'db')).toEqual(
      err({
        kind: 'refused',
        errorCode: 'FORBIDDEN',
        message: 'Owner access required',
      })
    );
    expect(cache.setQueryData).not.toHaveBeenCalled();
    expect(cache.invalidateQueries).not.toHaveBeenCalled();
  });

  it('reports a transport error as unreachable', async () => {
    const client: TrashDatabaseClient = {
      mutation: () => ({
        toPromise: async () => ({
          error: new CombinedError({ networkError: new Error('Offline') }),
        }),
      }),
    };

    expect(await trashDatabase(client, 'db')).toEqual(
      err({ kind: 'unreachable' })
    );
    expect(cache.setQueryData).not.toHaveBeenCalled();
  });

  it('reports an answer without an outcome as unreachable', async () => {
    const client: TrashDatabaseClient = {
      mutation: () => ({
        toPromise: async () => ({ data: { trashEntities: { results: [] } } }),
      }),
    };

    expect(await trashDatabase(client, 'db')).toEqual(
      err({ kind: 'unreachable' })
    );
    expect(cache.setQueryData).not.toHaveBeenCalled();
  });
});
