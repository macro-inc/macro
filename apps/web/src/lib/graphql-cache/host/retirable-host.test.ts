import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INITIAL_CACHE_REVISION } from '../protocol';
import { createNoopCacheHost } from './noop-host';
import { createRetirableCacheHost } from './retirable-host';
import type { CacheHost } from './types';

const QUERY = { query: 'query Q { user { id } }', operationName: 'Q' };

/** A host whose every call fails like a disposed worker host. */
function disposedLikeHost(): CacheHost {
  const rejecting = createNoopCacheHost();
  const disposed = () =>
    Promise.reject(new Error('cache worker host was disposed'));
  return {
    ...rejecting,
    clientId: 'inner-client',
    disabled: false,
    currentStorageGeneration: vi.fn(async () => 'generation-1'),
    readQuery: vi.fn(disposed),
    writeQuery: vi.fn(disposed),
    search: vi.fn(disposed),
    teardown: vi.fn(disposed),
    dispose: vi.fn(),
  };
}

describe('createRetirableCacheHost', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('delegates to the wrapped host until it is retired', async () => {
    const inner = disposedLikeHost();
    const host = createRetirableCacheHost(inner);

    expect(host.clientId).toBe('inner-client');
    expect(host.disabled).toBe(false);
    await expect(host.currentStorageGeneration()).resolves.toBe('generation-1');
    await expect(host.readQuery(QUERY)).rejects.toThrow(
      'cache worker host was disposed'
    );
    expect(inner.readQuery).toHaveBeenCalledOnce();
  });

  it('turns every captured reference into a disabled cache on dispose', async () => {
    const inner = disposedLikeHost();
    const host = createRetirableCacheHost(inner);

    host.dispose();

    expect(inner.dispose).toHaveBeenCalledOnce();
    // The owner already logged why it retired the cache.
    expect(console.warn).not.toHaveBeenCalled();
    expect(host.disabled).toBe(true);
    expect(host.clientId).toBe('inner-client');
    // Durable checkpoints must not trust a generation from a retired cache.
    await expect(host.currentStorageGeneration()).rejects.toThrow(
      'normalized GraphQL cache is unavailable'
    );
    await expect(host.readQuery(QUERY)).resolves.toEqual({ kind: 'miss' });
    await expect(
      host.writeQuery({ ...QUERY, data: { user: { id: 'u' } } })
    ).resolves.toMatchObject({ revision: INITIAL_CACHE_REVISION });
    await expect(
      host.search({ profile: 'quick-access-v1', query: '', limit: 10 })
    ).resolves.toEqual({ documents: [], nextCursor: null });
    await expect(host.teardown(1)).resolves.toBeUndefined();
    expect(inner.readQuery).not.toHaveBeenCalled();
    expect(inner.writeQuery).not.toHaveBeenCalled();
    expect(inner.search).not.toHaveBeenCalled();
    expect(inner.teardown).not.toHaveBeenCalled();
  });

  it('retires once', () => {
    const inner = disposedLikeHost();
    const host = createRetirableCacheHost(inner);

    host.dispose();
    host.dispose();

    expect(inner.dispose).toHaveBeenCalledOnce();
  });
});
