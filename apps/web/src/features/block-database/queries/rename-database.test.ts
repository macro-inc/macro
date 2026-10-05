import { databasesKeys, formsKeys } from '@queries/storage/keys';
import { CombinedError } from '@urql/core';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type RenameDatabaseClient, renameDatabase } from './rename-database';

const cache = vi.hoisted(() => ({
  setQueryData: vi.fn(),
  invalidateQueries: vi.fn(async () => undefined),
}));
vi.mock('@queries/client', () => ({ queryClient: cache }));
beforeEach(() => vi.clearAllMocks());

describe('rename database', () => {
  it('sends the trimmed name and renames the cached detail', async () => {
    const mutation = vi.fn<RenameDatabaseClient['mutation']>(() => ({
      toPromise: async () => ({
        data: {
          renameEntities: {
            results: [{ __typename: 'GraphqlMutationSuccess' }],
          },
        },
      }),
    }));

    expect(await renameDatabase({ mutation }, 'db', '  Roadmap  ')).toEqual(
      ok(undefined)
    );

    expect(mutation.mock.calls[0][1]).toEqual({
      id: 'db',
      displayName: 'Roadmap',
    });
    const update = cache.setQueryData.mock.calls[0][1];
    expect(update({ database: { id: 'db', name: 'Old' }, tables: [] })).toEqual(
      { database: { id: 'db', name: 'Roadmap' }, tables: [] }
    );
    expect(cache.invalidateQueries).toHaveBeenCalledWith({
      queryKey: databasesKeys.list.queryKey,
    });
    expect(cache.invalidateQueries).toHaveBeenCalledWith({
      queryKey: databasesKeys.detail('db').queryKey,
    });
    expect(cache.invalidateQueries).toHaveBeenCalledWith({
      queryKey: formsKeys.detail._def,
    });
    expect(cache.invalidateQueries).toHaveBeenCalledWith({
      queryKey: formsKeys.forDatabase('db').queryKey,
    });
    expect(cache.invalidateQueries).toHaveBeenCalledWith({
      queryKey: formsKeys.list.queryKey,
    });
  });

  it('carries the refusal code and leaves the cache intact', async () => {
    const client: RenameDatabaseClient = {
      mutation: () => ({
        toPromise: async () => ({
          data: {
            renameEntities: {
              results: [
                {
                  __typename: 'GraphqlMutationError',
                  errorCode: 'NOT_FOUND',
                  message: 'Database not found',
                },
              ],
            },
          },
        }),
      }),
    };

    expect(await renameDatabase(client, 'db', 'Roadmap')).toEqual(
      err({
        kind: 'refused',
        errorCode: 'NOT_FOUND',
        message: 'Database not found',
      })
    );
    expect(cache.setQueryData).not.toHaveBeenCalled();
    expect(cache.invalidateQueries).not.toHaveBeenCalled();
  });

  it('reports a transport error as unreachable', async () => {
    const client: RenameDatabaseClient = {
      mutation: () => ({
        toPromise: async () => ({
          error: new CombinedError({ networkError: new Error('Offline') }),
        }),
      }),
    };

    expect(await renameDatabase(client, 'db', 'Roadmap')).toEqual(
      err({ kind: 'unreachable' })
    );
    expect(cache.setQueryData).not.toHaveBeenCalled();
  });

  it('refuses a blank name without sending it', async () => {
    const mutation = vi.fn<RenameDatabaseClient['mutation']>();

    expect(await renameDatabase({ mutation }, 'db', '   ')).toEqual(
      err({ kind: 'empty-name' })
    );
    expect(mutation).not.toHaveBeenCalled();
  });
});
