import { describe, expect, it, vi } from 'vitest';
import { cacheDatabaseIdentity } from './coordinator-protocol';
import {
  removeStaleCacheDatabases,
  staleCacheDatabaseIdentities,
} from './stale-databases';

describe('stale cache databases', () => {
  it('lists each stale database of the scope once, whichever file remains', () => {
    const own = cacheDatabaseIdentity('scope');
    expect(
      staleCacheDatabaseIdentities('scope', [
        own,
        `${own}-wal`,
        'graphql-cache:scope',
        'graphql-cache:scope-wal',
        'graphql-cache:scope:s1.v1.t1-wal',
        'graphql-cache:other-scope',
        'unrelated.db',
      ])
    ).toEqual(['graphql-cache:scope', 'graphql-cache:scope:s1.v1.t1']);
  });

  it('tallies each outcome and stops at the first failure', async () => {
    const removeOne = vi
      .fn()
      .mockResolvedValueOnce({ outcome: 'removed' })
      .mockResolvedValueOnce({ outcome: 'in-use' })
      .mockResolvedValueOnce({
        outcome: 'queued-mutations',
        queuedMutations: 3,
      })
      .mockRejectedValueOnce(new Error('unreadable database'));

    expect(
      await removeStaleCacheDatabases(['a', 'b', 'c', 'd', 'e'], removeOne)
    ).toEqual({
      removed: 1,
      inUse: 1,
      keptWithQueuedMutations: 1,
      failed: true,
    });
    expect(removeOne).toHaveBeenCalledTimes(4);
  });
});
