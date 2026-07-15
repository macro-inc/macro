import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CacheHost } from './host/types';

function hostWithClear(clear: () => Promise<void>): CacheHost {
  return { clear } as CacheHost;
}

describe('clearRegisteredCaches', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.resetModules();
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
