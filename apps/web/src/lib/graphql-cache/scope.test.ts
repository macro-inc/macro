import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { quarantineCacheScope, rotateCacheScope } from './scope';

const STORAGE_KEY = 'graphql-cache:scope';

type LockRequest = {
  run: () => Promise<void>;
};

function controlledLockManager(): {
  lockManager: Pick<LockManager, 'request'>;
  requests: LockRequest[];
} {
  const requests: LockRequest[] = [];
  const lockManager = {
    request: vi.fn(
      <T>(
        _name: string,
        _options: LockOptions,
        callback: (lock: Lock | null) => T | PromiseLike<T>
      ): Promise<T> =>
        new Promise<T>((resolve, reject) => {
          requests.push({
            run: async () => {
              try {
                resolve(
                  await callback({
                    name: 'graphql-cache:scope-storage',
                    mode: 'exclusive',
                  } as Lock)
                );
              } catch (error) {
                reject(error);
              }
            },
          });
        })
    ),
  } as unknown as Pick<LockManager, 'request'>;
  return { lockManager, requests };
}

describe('serialized cache scope replacement', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('falls back synchronously only when Web Locks are unavailable', async () => {
    vi.stubGlobal('navigator', {});
    localStorage.setItem(STORAGE_KEY, 'old-scope');

    await expect(quarantineCacheScope('old-scope')).resolves.toBe(
      'quarantine:old-scope'
    );
    expect(localStorage.getItem(STORAGE_KEY)).toBe('quarantine:old-scope');
  });

  it('does not use an unsafe fallback when an advertised lock fails', async () => {
    vi.stubGlobal('navigator', {
      locks: { request: vi.fn().mockRejectedValue(new Error('lock failed')) },
    });
    localStorage.setItem(STORAGE_KEY, 'old-scope');

    await expect(quarantineCacheScope('old-scope')).resolves.toBeUndefined();
    expect(localStorage.getItem(STORAGE_KEY)).toBe('old-scope');
  });

  it('serializes a stale S1 quarantine behind an S2 rotation', async () => {
    const { lockManager, requests } = controlledLockManager();
    vi.stubGlobal('navigator', { locks: lockManager });
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(
      '22222222-2222-4222-8222-222222222222'
    );
    localStorage.setItem(STORAGE_KEY, 'scope-1');

    const staleQuarantine = quarantineCacheScope('scope-1');
    const rotateToScope2 = rotateCacheScope();
    expect(requests).toHaveLength(2);
    await requests[1]?.run();
    await expect(rotateToScope2).resolves.toBe(
      '22222222-2222-4222-8222-222222222222'
    );
    await requests[0]?.run();
    await expect(staleQuarantine).resolves.toBeUndefined();

    expect(localStorage.getItem(STORAGE_KEY)).toBe(
      '22222222-2222-4222-8222-222222222222'
    );
  });

  it('converges serialized failures that observed the same S1 scope', async () => {
    const { lockManager, requests } = controlledLockManager();
    vi.stubGlobal('navigator', { locks: lockManager });
    localStorage.setItem(STORAGE_KEY, 'scope-1');

    const first = quarantineCacheScope('scope-1');
    const second = quarantineCacheScope('scope-1');
    await requests[0]?.run();
    await requests[1]?.run();

    await expect(first).resolves.toBe('quarantine:scope-1');
    await expect(second).resolves.toBe('quarantine:scope-1');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('quarantine:scope-1');
  });
});
