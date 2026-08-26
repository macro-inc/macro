import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CacheHost } from './host/types';

function hostWithClear(clear: () => Promise<unknown>): CacheHost {
  return { clear } as unknown as CacheHost;
}

describe('clearRegisteredCaches', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('preserves the scope when every cache clears', async () => {
    localStorage.setItem('graphql-cache:scope', 'current-scope');
    const clear = vi.fn().mockResolvedValue(undefined);
    const { clearRegisteredCaches, registerCacheHost } = await import(
      './lifecycle'
    );
    registerCacheHost(hostWithClear(clear));

    await clearRegisteredCaches();

    expect(clear).toHaveBeenCalledOnce();
    expect(localStorage.getItem('graphql-cache:scope')).toBe('current-scope');
  });

  it('awaits the serialized scope rotation before logout clearing resolves', async () => {
    localStorage.setItem('graphql-cache:scope', 'current-scope');
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(
      '00000000-0000-4000-8000-000000000002'
    );
    let enterLock!: () => void;
    const lockGate = new Promise<void>((resolve) => {
      enterLock = resolve;
    });
    vi.stubGlobal('navigator', {
      locks: {
        request: vi.fn(
          async (
            name: string,
            _options: LockOptions,
            callback: (lock: Lock | null) => unknown
          ) => {
            await lockGate;
            return await callback({ name, mode: 'exclusive' } as Lock);
          }
        ),
      },
    });
    const { clearRegisteredCaches, registerCacheHost } = await import(
      './lifecycle'
    );
    registerCacheHost(
      hostWithClear(async () => await Promise.reject(new Error('wipe failed')))
    );
    let settled = false;

    const clearing = clearRegisteredCaches().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(localStorage.getItem('graphql-cache:scope')).toBe('current-scope');
    enterLock();
    await clearing;

    expect(localStorage.getItem('graphql-cache:scope')).toBe(
      '00000000-0000-4000-8000-000000000002'
    );
  });

  it('rotates the scope after attempting every clear when one fails', async () => {
    localStorage.setItem('graphql-cache:scope', 'current-scope');
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(
      '00000000-0000-4000-8000-000000000001'
    );
    const successfulClear = vi.fn().mockResolvedValue(undefined);
    const failedClear = vi
      .fn()
      .mockRejectedValue(new Error('durable wipe failed'));
    const { clearRegisteredCaches, registerCacheHost } = await import(
      './lifecycle'
    );
    registerCacheHost(hostWithClear(successfulClear));
    registerCacheHost(hostWithClear(failedClear));

    await clearRegisteredCaches();

    expect(successfulClear).toHaveBeenCalledOnce();
    expect(failedClear).toHaveBeenCalledOnce();
    expect(localStorage.getItem('graphql-cache:scope')).toBe(
      '00000000-0000-4000-8000-000000000001'
    );
  });
});
