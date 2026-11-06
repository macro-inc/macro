import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNoopCacheHost } from './host/noop-host';
import { createRetirableCacheHost } from './host/retirable-host';
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

  it('preserves the scope and clears external cursors when every cache clears', async () => {
    localStorage.setItem('graphql-cache:scope', 'current-scope');
    localStorage.setItem('graphql-soup-backfill:v6:user-1:core', '{}');
    localStorage.setItem('graphql-soup-backfill:v7:user-1:email', '{}');
    localStorage.setItem('unrelated', 'keep');
    const clear = vi.fn().mockResolvedValue(undefined);
    const { clearRegisteredCaches, registerCacheHost } = await import(
      './lifecycle'
    );
    registerCacheHost(hostWithClear(clear));

    await clearRegisteredCaches();

    expect(clear).toHaveBeenCalledOnce();
    expect(localStorage.getItem('graphql-cache:scope')).toBe('current-scope');
    expect(localStorage.getItem('graphql-soup-backfill:v6:user-1:core')).toBe(
      null
    );
    expect(localStorage.getItem('graphql-soup-backfill:v7:user-1:email')).toBe(
      null
    );
    expect(localStorage.getItem('unrelated')).toBe('keep');
  });

  it('rotates the scope when no cache host is registered', async () => {
    localStorage.setItem('graphql-cache:scope', 'current-scope');
    localStorage.setItem('graphql-soup-backfill:v7:user-1:email', '{}');
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(
      '00000000-0000-4000-8000-000000000003'
    );
    const { clearRegisteredCaches } = await import('./lifecycle');

    await clearRegisteredCaches();

    expect(localStorage.getItem('graphql-cache:scope')).toBe(
      '00000000-0000-4000-8000-000000000003'
    );
    expect(localStorage.getItem('graphql-soup-backfill:v7:user-1:email')).toBe(
      null
    );
  });

  it('rotates the scope once the last host unregisters', async () => {
    localStorage.setItem('graphql-cache:scope', 'current-scope');
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(
      '00000000-0000-4000-8000-000000000004'
    );
    const clear = vi.fn().mockResolvedValue(undefined);
    const { clearRegisteredCaches, registerCacheHost } = await import(
      './lifecycle'
    );
    const unregister = registerCacheHost(hostWithClear(clear));
    unregister();

    await clearRegisteredCaches();

    expect(clear).not.toHaveBeenCalled();
    expect(localStorage.getItem('graphql-cache:scope')).toBe(
      '00000000-0000-4000-8000-000000000004'
    );
  });

  it('rotates the scope when only a storage-free host is registered', async () => {
    localStorage.setItem('graphql-cache:scope', 'current-scope');
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(
      '00000000-0000-4000-8000-000000000005'
    );
    const { clearRegisteredCaches, registerCacheHost } = await import(
      './lifecycle'
    );
    registerCacheHost({
      clear: vi.fn().mockResolvedValue(undefined),
      disabled: true,
    } as unknown as CacheHost);

    await clearRegisteredCaches();

    expect(localStorage.getItem('graphql-cache:scope')).toBe(
      '00000000-0000-4000-8000-000000000005'
    );
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

  it('preserves a persisted scope on login without session-written records or a mounted host', async () => {
    localStorage.setItem('graphql-cache:scope', 'pending-drafts-scope');
    const { replaceCacheWriteSession } = await import('./lifecycle');
    const session = replaceCacheWriteSession();
    await session.ready;
    expect(session.isCurrent()).toBe(true);
    expect(localStorage.getItem('graphql-cache:scope')).toBe(
      'pending-drafts-scope'
    );
  });

  it('rejects retired-host repair without forgetting the records or rotating queued drafts away', async () => {
    localStorage.setItem('graphql-cache:scope', 'pending-drafts-scope');
    const { recordSessionCacheWrite, replaceCacheWriteSession } = await import(
      './lifecycle'
    );
    const host = createRetirableCacheHost({
      ...createNoopCacheHost(),
      disabled: false,
    });
    host.dispose();
    recordSessionCacheWrite(host, 'GraphqlSoupCrmContact:old-contact');
    const first = replaceCacheWriteSession();
    await expect(first.ready).rejects.toThrow(
      'Contact cache repair unavailable'
    );
    expect(first.isCurrent()).toBe(false);
    const retry = replaceCacheWriteSession();
    await expect(retry.ready).rejects.toThrow(
      'Contact cache repair unavailable'
    );
    expect(retry.isCurrent()).toBe(false);
    expect(localStorage.getItem('graphql-cache:scope')).toBe(
      'pending-drafts-scope'
    );
  });
});

it('repairs the exact retired owner before a replacement exists, preserving queued drafts', async () => {
  vi.resetModules();
  const { createRetirableCacheHost } = await import('./host/retirable-host');
  const {
    recordSessionCacheWrite,
    registerCacheHost,
    replaceCacheWriteSession,
  } = await import('./lifecycle');
  const stored = new Map([
    ['GraphqlSoupCrmContact:old-contact', { name: 'Old contact' }],
    ['queued-draft', { text: 'Unsent draft' }],
  ]);
  const inner = {
    ...createNoopCacheHost(),
    disabled: false,
    deleteRecords: vi.fn(async (keys: string[]) => {
      for (const key of keys) stored.delete(key);
      return createNoopCacheHost().deleteRecords(keys);
    }),
    clear: vi.fn(),
    dispose: vi.fn(),
  };
  const owner = createRetirableCacheHost(inner);
  const unregister = registerCacheHost(owner);
  recordSessionCacheWrite(owner, 'GraphqlSoupCrmContact:old-contact');
  unregister();
  owner.dispose();
  expect(inner.dispose).not.toHaveBeenCalled();
  // A different mounted storage must never receive the old owner's keys.
  const other = {
    ...createNoopCacheHost(),
    disabled: false,
    deleteRecords: vi.fn(),
  };
  const unregisterOther = registerCacheHost(other);
  const next = replaceCacheWriteSession();
  await next.ready;
  expect(next.isCurrent()).toBe(true);
  expect(stored).toEqual(new Map([['queued-draft', { text: 'Unsent draft' }]]));
  expect(inner.clear).not.toHaveBeenCalled();
  expect(inner.dispose).toHaveBeenCalledOnce();
  expect(other.deleteRecords).not.toHaveBeenCalled();
  await replaceCacheWriteSession().ready;
  expect(inner.deleteRecords).toHaveBeenCalledOnce();
  unregisterOther();
});

it('retains failed cleanup ownership for a later same-document retry', async () => {
  vi.resetModules();
  const { createRetirableCacheHost } = await import('./host/retirable-host');
  const { recordSessionCacheWrite, replaceCacheWriteSession } = await import(
    './lifecycle'
  );
  const stored = new Set(['GraphqlSoupCrmContact:old-contact', 'queued-draft']);
  const deleteRecords = vi
    .fn(async (keys: string[]) => {
      for (const key of keys) stored.delete(key);
      return createNoopCacheHost().deleteRecords(keys);
    })
    .mockRejectedValueOnce(new Error('Storage temporarily unavailable'));
  const inner = {
    ...createNoopCacheHost(),
    disabled: false,
    deleteRecords,
    dispose: vi.fn(),
  };
  const owner = createRetirableCacheHost(inner);
  recordSessionCacheWrite(owner, 'GraphqlSoupCrmContact:old-contact');
  owner.dispose();
  await expect(replaceCacheWriteSession().ready).rejects.toThrow(
    'Storage temporarily unavailable'
  );
  expect(stored.size).toBe(2);
  expect(inner.dispose).not.toHaveBeenCalled();
  const retry = replaceCacheWriteSession();
  await retry.ready;
  expect(retry.isCurrent()).toBe(true);
  expect(stored).toEqual(new Set(['queued-draft']));
  expect(inner.dispose).toHaveBeenCalledOnce();
});

it('holds the physical owner through auth retirement and a rejected logout callback', async () => {
  vi.resetModules();
  const { createRetirableCacheHost } = await import('./host/retirable-host');
  const {
    recordSessionCacheWrite,
    registerCacheHost,
    clearRegisteredCaches,
    replaceCacheWriteSession,
  } = await import('./lifecycle');
  const { captureCacheWriteSession } = await import('./session-writes');
  const held = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  const signedOut = Promise.withResolvers<void>();
  const stored = new Set<string>();
  const order: string[] = [];
  const inner = {
    ...createNoopCacheHost(),
    disabled: false,
    writeQuery: async () => {
      started.resolve();
      await held.promise;
      stored.add('GraphqlSoupCrmContact:old-contact');
      order.push('write');
      return createNoopCacheHost().writeQuery({ query: '', data: {} });
    },
    clear: async () => {
      stored.clear();
      order.push('clear');
      return createNoopCacheHost().clear();
    },
    dispose: vi.fn(() => {
      order.push('dispose');
    }),
  };
  const owner = createRetirableCacheHost(inner);
  const unregister = registerCacheHost(owner);
  const writing = captureCacheWriteSession().run(async () => {
    recordSessionCacheWrite(owner, 'GraphqlSoupCrmContact:old-contact');
    await owner.writeQuery({ query: '', data: {} });
  });
  await started.promise;
  const ending = clearRegisteredCaches(async () => {
    unregister();
    owner.dispose();
    signedOut.resolve();
    throw new Error('Independent logout failure');
  });
  const rejected = expect(ending).rejects.toThrow('Independent logout failure');
  await signedOut.promise;
  expect(owner.disabled).toBe(true);
  expect(inner.dispose).not.toHaveBeenCalled();
  expect(order).toEqual([]);
  const next = replaceCacheWriteSession();
  expect(next.isCurrent()).toBe(false);
  held.resolve();
  await Promise.all([writing, rejected, next.ready]);
  expect(order).toEqual(['write', 'clear', 'dispose']);
  expect(stored.size).toBe(0);
  expect(next.isCurrent()).toBe(true);
});

it('pins a retired owner independently when logout overlaps replacement deletion', async () => {
  vi.resetModules();
  const { createRetirableCacheHost } = await import('./host/retirable-host');
  const {
    recordSessionCacheWrite,
    clearRegisteredCaches,
    replaceCacheWriteSession,
  } = await import('./lifecycle');
  const deleting = Promise.withResolvers<void>();
  const held = Promise.withResolvers<void>();
  let disposed = false;
  const order: string[] = [];
  const inner = {
    ...createNoopCacheHost(),
    disabled: false,
    deleteRecords: async (keys: string[]) => {
      deleting.resolve();
      await held.promise;
      order.push('delete');
      return createNoopCacheHost().deleteRecords(keys);
    },
    clear: async () => {
      expect(disposed).toBe(false);
      order.push('clear');
      return createNoopCacheHost().clear();
    },
    dispose: () => {
      disposed = true;
      order.push('dispose');
    },
  };
  const host = createRetirableCacheHost(inner);
  recordSessionCacheWrite(host, 'GraphqlSoupCrmContact:old-contact');
  host.dispose();
  const login = replaceCacheWriteSession();
  await deleting.promise;
  const logout = clearRegisteredCaches();
  held.resolve();
  await Promise.all([login.ready, logout]);
  expect(login.isCurrent()).toBe(false);
  expect(order).toEqual(['delete', 'clear', 'dispose']);
});

it('uses only the original storage recovery factory after a proven owner loss', async () => {
  vi.resetModules();
  const { createRetirableCacheHost } = await import('./host/retirable-host');
  const {
    recordSessionCacheWrite,
    registerCacheHost,
    replaceCacheWriteSession,
  } = await import('./lifecycle');
  const stored = new Set(['GraphqlSoupCrmContact:old-contact', 'queued-draft']);
  const ownerLost = new Error('Owner lock unavailable');
  const oldInner = {
    ...createNoopCacheHost(),
    disabled: false,
    deleteRecords: vi.fn(async () => {
      throw ownerLost;
    }),
    dispose: vi.fn(),
  };
  const recoveredInner = {
    ...createNoopCacheHost(),
    disabled: false,
    deleteRecords: vi.fn(async (keys: string[]) => {
      for (const key of keys) stored.delete(key);
      return createNoopCacheHost().deleteRecords(keys);
    }),
    clear: vi.fn(),
    dispose: vi.fn(),
  };
  const recover = vi.fn((error: unknown) =>
    error === ownerLost ? createRetirableCacheHost(recoveredInner) : undefined
  );
  const host = createRetirableCacheHost(oldInner);
  const unregister = registerCacheHost(host, recover);
  recordSessionCacheWrite(host, 'GraphqlSoupCrmContact:old-contact');
  unregister();
  host.dispose();
  const unrelated = {
    ...createNoopCacheHost(),
    disabled: false,
    deleteRecords: vi.fn(),
  };
  const unregisterOther = registerCacheHost(unrelated);
  const next = replaceCacheWriteSession();
  await next.ready;
  expect(next.isCurrent()).toBe(true);
  expect(recover).toHaveBeenCalledExactlyOnceWith(ownerLost);
  expect(stored).toEqual(new Set(['queued-draft']));
  expect(unrelated.deleteRecords).not.toHaveBeenCalled();
  expect(recoveredInner.clear).not.toHaveBeenCalled();
  expect(oldInner.dispose).toHaveBeenCalledOnce();
  expect(recoveredInner.dispose).toHaveBeenCalledOnce();
  unregisterOther();
});

it('keeps keys and the recovered owner when its first delete fails', async () => {
  vi.resetModules();
  const { createRetirableCacheHost } = await import('./host/retirable-host');
  const {
    recordSessionCacheWrite,
    registerCacheHost,
    replaceCacheWriteSession,
  } = await import('./lifecycle');
  const ownerLost = new Error('Owner lost');
  const old = createRetirableCacheHost({
    ...createNoopCacheHost(),
    disabled: false,
    deleteRecords: async () => {
      throw ownerLost;
    },
  });
  const stored = new Set(['GraphqlSoupCrmContact:old-contact', 'queued-draft']);
  const recovered = {
    ...createNoopCacheHost(),
    disabled: false,
    dispose: vi.fn(),
    deleteRecords: vi
      .fn(async (keys: string[]) => {
        for (const key of keys) stored.delete(key);
        return createNoopCacheHost().deleteRecords(keys);
      })
      .mockRejectedValueOnce(new Error('Temporary delete failure')),
  };
  const recover = vi.fn((error: unknown) =>
    error === ownerLost ? createRetirableCacheHost(recovered) : undefined
  );
  const unregister = registerCacheHost(old, recover);
  recordSessionCacheWrite(old, 'GraphqlSoupCrmContact:old-contact');
  old.dispose();
  unregister();
  await expect(replaceCacheWriteSession().ready).rejects.toThrow(
    'Temporary delete failure'
  );
  expect(stored.size).toBe(2);
  expect(recovered.dispose).not.toHaveBeenCalled();
  await replaceCacheWriteSession().ready;
  expect(stored).toEqual(new Set(['queued-draft']));
  expect(recover).toHaveBeenCalledOnce();
  expect(recovered.dispose).toHaveBeenCalledOnce();
});

it.each([false, true])(
  'clears the recovered store when logout queued during owner loss (delete fails=%s)',
  async (deleteFails) => {
    vi.resetModules();
    const { createRetirableCacheHost } = await import('./host/retirable-host');
    const {
      recordSessionCacheWrite,
      registerCacheHost,
      clearRegisteredCaches,
      replaceCacheWriteSession,
    } = await import('./lifecycle');
    localStorage.setItem('graphql-cache:scope', 'original-scope');
    const held = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    const lost = new Error('Owner lost');
    const stored = new Set([
      'GraphqlSoupCrmContact:old-contact',
      'queued-draft',
    ]);
    const old = createRetirableCacheHost({
      ...createNoopCacheHost(),
      disabled: false,
      deleteRecords: async () => {
        started.resolve();
        await held.promise;
        throw lost;
      },
      clear: async () => {
        throw lost;
      },
    });
    const cleared = vi.fn();
    const recover = (error: unknown) =>
      error !== lost
        ? undefined
        : createRetirableCacheHost({
            ...createNoopCacheHost(),
            disabled: false,
            deleteRecords: async (keys: string[]) => {
              if (deleteFails) throw new Error('Delete failed');
              for (const key of keys) stored.delete(key);
              return createNoopCacheHost().deleteRecords(keys);
            },
            clear: async () => {
              stored.clear();
              cleared();
              return createNoopCacheHost().clear();
            },
          });
    const unregister = registerCacheHost(old, recover);
    recordSessionCacheWrite(old, 'GraphqlSoupCrmContact:old-contact');
    old.dispose();
    unregister();
    const login = replaceCacheWriteSession();
    const loginResult = login.ready.catch((error: unknown) => error);
    await started.promise;
    const logout = clearRegisteredCaches();
    held.resolve();
    await Promise.all([loginResult, logout]);
    expect(cleared).toHaveBeenCalledOnce();
    expect(stored.size).toBe(0);
    expect(localStorage.getItem('graphql-cache:scope')).toBe('original-scope');
    expect(login.isCurrent()).toBe(false);
    const next = replaceCacheWriteSession();
    await next.ready;
    expect(next.isCurrent()).toBe(true);
  }
);
