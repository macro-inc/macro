import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INITIAL_CACHE_REVISION } from '../protocol';
import { createNoopCacheHost } from './noop-host';
import { createRetirableCacheHost, retainCacheHost } from './retirable-host';
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

  it('forwards retry accounting and permanent-failure codes', async () => {
    const inner = createNoopCacheHost();
    const defer = vi.spyOn(inner, 'deferOptimisticWrite');
    const rollback = vi.spyOn(inner, 'rollbackOptimisticWrite');
    const host = createRetirableCacheHost(inner);
    const claim = { owner: 'runner', generation: '2' };
    await host.deferOptimisticWrite('1', claim, 100, 'server failed', true);
    expect(defer).toHaveBeenCalledWith('1', claim, 100, 'server failed', true);
    await host.rollbackOptimisticWrite(
      '1',
      claim,
      'exhausted',
      'MUTATION_RETRY_EXHAUSTED'
    );
    expect(rollback).toHaveBeenCalledWith(
      '1',
      claim,
      'exhausted',
      'MUTATION_RETRY_EXHAUSTED'
    );
  });

  it('retires once', () => {
    const inner = disposedLikeHost();
    const host = createRetirableCacheHost(inner);

    host.dispose();
    host.dispose();

    expect(inner.dispose).toHaveBeenCalledOnce();
  });
});

it('keeps the physical host alive until every idempotent lease is released', async () => {
  const inner = disposedLikeHost();
  const host = createRetirableCacheHost(inner);
  const first = retainCacheHost(host);
  const second = retainCacheHost(host);
  expect(first?.host).toBe(inner);
  expect(second?.host).toBe(inner);
  host.dispose();
  expect(host.disabled).toBe(true);
  expect(retainCacheHost(host)).toBeUndefined();
  expect(inner.dispose).not.toHaveBeenCalled();
  await expect(host.readQuery(QUERY)).resolves.toEqual({ kind: 'miss' });
  first?.release();
  first?.release();
  expect(inner.dispose).not.toHaveBeenCalled();
  second?.release();
  second?.release();
  host.dispose();
  expect(inner.dispose).toHaveBeenCalledOnce();
});

it('silences retired public subscriptions while retained storage still emits events', () => {
  let affected: Parameters<CacheHost['onOpsAffected']>[0] | undefined;
  let changed: Parameters<CacheHost['onCacheChanged']>[0] | undefined;
  let generation:
    | Parameters<CacheHost['onCacheGenerationChanged']>[0]
    | undefined;
  let settled: Parameters<CacheHost['onMutationSettled']>[0] | undefined;
  const inner = {
    ...createNoopCacheHost(),
    disabled: false,
    dispose: vi.fn(),
    onOpsAffected: (cb: Parameters<CacheHost['onOpsAffected']>[0]) => {
      affected = cb;
      return () => {};
    },
    onCacheChanged: (cb: Parameters<CacheHost['onCacheChanged']>[0]) => {
      changed = cb;
      return () => {};
    },
    onCacheGenerationChanged: (
      cb: Parameters<CacheHost['onCacheGenerationChanged']>[0]
    ) => {
      generation = cb;
      return () => {};
    },
    onMutationSettled: (cb: Parameters<CacheHost['onMutationSettled']>[0]) => {
      settled = cb;
      return () => {};
    },
  };
  const host = createRetirableCacheHost(inner);
  const callbacks = [vi.fn(), vi.fn(), vi.fn(), vi.fn()];
  host.onOpsAffected(callbacks[0]);
  host.onCacheChanged(callbacks[1]);
  host.onCacheGenerationChanged(callbacks[2]);
  host.onMutationSettled(callbacks[3]);
  const retained = retainCacheHost(host);
  affected?.([1]);
  expect(callbacks[0]).toHaveBeenCalledOnce();
  callbacks[0].mockClear();
  host.dispose();
  affected?.([2]);
  changed?.(INITIAL_CACHE_REVISION);
  generation?.({ storage: 'preserved' });
  settled?.({ transactionId: 'draft', status: 'committed' });
  for (const callback of callbacks) expect(callback).not.toHaveBeenCalled();
  expect(inner.dispose).not.toHaveBeenCalled();
  retained?.release();
  expect(inner.dispose).toHaveBeenCalledOnce();
});
