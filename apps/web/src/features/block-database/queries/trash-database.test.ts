import type { Client } from '@urql/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { trashDatabase } from './trash-database';

const cache = vi.hoisted(() => ({
  setQueryData: vi.fn(),
  invalidateQueries: vi.fn(),
}));
vi.mock('@queries/client', () => ({ queryClient: cache }));
beforeEach(() => vi.clearAllMocks());

function clientWith(response: unknown) {
  const mutation = vi.fn(() => ({ toPromise: async () => response }));
  return {
    client: { mutation } as unknown as Pick<Client, 'mutation'>,
    mutation,
  };
}

describe('trash database', () => {
  it('uses the database entity mutation without requesting Soup effects and removes only the confirmed item', async () => {
    const { client, mutation } = clientWith({
      data: {
        trashEntities: { results: [{ __typename: 'GraphqlMutationSuccess' }] },
      },
    });
    await trashDatabase(client, 'db');
    expect(mutation).toHaveBeenCalledWith(
      expect.not.stringContaining('effects'),
      { entities: [{ type: 'DATABASE', id: 'db' }] }
    );
    const update = cache.setQueryData.mock.calls[0][1];
    expect(
      update([{ database: { id: 'db' } }, { database: { id: 'other' } }])
    ).toEqual([{ database: { id: 'other' } }]);
    expect(cache.invalidateQueries).toHaveBeenCalledTimes(2);
  });
  it.each([
    { error: new Error('Offline') },
    {
      data: {
        trashEntities: {
          results: [
            {
              __typename: 'GraphqlMutationError',
              message: 'Owner access required',
            },
          ],
        },
      },
    },
    { data: { trashEntities: { results: [] } } },
  ])(
    'leaves cached databases intact on a rejected or missing outcome',
    async (response) => {
      const { client } = clientWith(response);
      await expect(trashDatabase(client, 'db')).rejects.toThrow();
      expect(cache.setQueryData).not.toHaveBeenCalled();
      expect(cache.invalidateQueries).not.toHaveBeenCalled();
    }
  );
});
