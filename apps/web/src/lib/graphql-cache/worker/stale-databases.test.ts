import { describe, expect, it, vi } from 'vitest';
import { cacheDatabaseIdentity } from './coordinator-protocol';
import {
  isUnambiguousCacheScope,
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
        'graphql-cache:scope:s1.v1.t0',
        'graphql-cache:scope:s1.v1.t0-wal',
        'graphql-cache:scope:s1.v1.t1-wal',
        'graphql-cache:other-scope',
        'unrelated.db',
      ])
    ).toEqual(['graphql-cache:scope:s1.v1.t0', 'graphql-cache:scope:s1.v1.t1']);
  });

  it('refuses scopes whose database would read as another WAL file', () => {
    expect(
      isUnambiguousCacheScope('4f7c9d1e-0b2a-4c8e-9f31-7a6d5e4c3b2a')
    ).toBe(true);
    expect(isUnambiguousCacheScope('quarantine:scope')).toBe(true);
    expect(isUnambiguousCacheScope('scope-wal')).toBe(false);
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
