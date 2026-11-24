import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rotateCacheScope } from './scope';

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

    const scope = await rotateCacheScope();

    expect(scope).toEqual(expect.any(String));
    expect(scope).not.toBe('old-scope');
    expect(localStorage.getItem(STORAGE_KEY)).toBe(scope);
  });

  it('does not use an unsafe fallback when an advertised lock fails', async () => {
    vi.stubGlobal('navigator', {
      locks: { request: vi.fn().mockRejectedValue(new Error('lock failed')) },
    });
    localStorage.setItem(STORAGE_KEY, 'old-scope');

    await expect(rotateCacheScope()).resolves.toBeUndefined();
    expect(localStorage.getItem(STORAGE_KEY)).toBe('old-scope');
  });

  it('replaces the scope only while it holds the cross-tab lock', async () => {
    const { lockManager, requests } = controlledLockManager();
    vi.stubGlobal('navigator', { locks: lockManager });
    localStorage.setItem(STORAGE_KEY, 'scope-1');

    const rotated = rotateCacheScope();
    expect(requests).toHaveLength(1);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('scope-1');

    await requests[0]?.run();
    expect(localStorage.getItem(STORAGE_KEY)).toBe(await rotated);
  });
});
