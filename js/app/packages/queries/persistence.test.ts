import { partialMatchKey } from '@tanstack/query-core';
import { QueryClient } from '@tanstack/solid-query';
import { describe, expect, it, vi } from 'vitest';
import type {
  PerQueryPersistence,
  PersistedQueryEntry,
} from './persistence/per-query-idb';
import { setupQueryPersistence, type PersistScope } from './persistence';

function createMockStore(): PerQueryPersistence & {
  entries: Map<string, PersistedQueryEntry>;
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  flush: ReturnType<typeof vi.fn>;
} {
  const entries = new Map<string, PersistedQueryEntry>();
  return {
    entries,
    get: vi.fn(async (hash: string) => entries.get(hash)),
    set: vi.fn((entry: PersistedQueryEntry) => {
      entries.set(entry.queryHash, entry);
    }),
    remove: vi.fn((hash: string) => {
      entries.delete(hash);
    }),
    flush: vi.fn(async () => {}),
  };
}

function createScope(
  prefix: readonly unknown[],
  store: PerQueryPersistence,
  overrides?: Partial<PersistScope>
): PersistScope {
  return {
    store,
    maxAgeMs: 1000 * 60 * 60 * 24 * 7,
    buster: 'test',
    shouldPersist: (key) => partialMatchKey(key, prefix),
    ...overrides,
  };
}

describe('setupQueryPersistence', () => {
  it('writes only the changed query on update', () => {
    const queryClient = new QueryClient();
    const store = createMockStore();
    const scope = createScope(['channel'], store);

    setupQueryPersistence({ queryClient, scopes: [scope] });

    queryClient.setQueryData(['channel', 'a'], { value: 1 });
    queryClient.setQueryData(['channel', 'b'], { value: 2 });

    expect(store.set).toHaveBeenCalledTimes(2);
    const firstCall = store.set.mock.calls[0]![0] as PersistedQueryEntry;
    const secondCall = store.set.mock.calls[1]![0] as PersistedQueryEntry;
    expect(firstCall.queryKey).toEqual(['channel', 'a']);
    expect(firstCall.data).toEqual({ value: 1 });
    expect(secondCall.queryKey).toEqual(['channel', 'b']);
    expect(secondCall.data).toEqual({ value: 2 });
  });

  it('isolates writes to the matching scope store', () => {
    const queryClient = new QueryClient();
    const channelStore = createMockStore();
    const emailStore = createMockStore();

    setupQueryPersistence({
      queryClient,
      scopes: [
        createScope(['channel'], channelStore),
        createScope(['email', 'threadMessages'], emailStore),
      ],
    });

    queryClient.setQueryData(['channel', 'a'], { value: 'ch' });
    queryClient.setQueryData(['email', 'threadMessages', 't-1'], {
      value: 'em',
    });

    expect(channelStore.set).toHaveBeenCalledTimes(1);
    expect(emailStore.set).toHaveBeenCalledTimes(1);
    expect(
      (channelStore.set.mock.calls[0]![0] as PersistedQueryEntry).queryKey
    ).toEqual(['channel', 'a']);
    expect(
      (emailStore.set.mock.calls[0]![0] as PersistedQueryEntry).queryKey
    ).toEqual(['email', 'threadMessages', 't-1']);
  });

  it('ignores queries that match no scope', () => {
    const queryClient = new QueryClient();
    const store = createMockStore();
    const scope = createScope(['channel'], store);

    setupQueryPersistence({ queryClient, scopes: [scope] });

    queryClient.setQueryData(['preview', 'x'], { value: 'ignored' });

    expect(store.set).not.toHaveBeenCalled();
  });

  it('restores query data from store on added event', async () => {
    const queryClient = new QueryClient();
    const store = createMockStore();

    store.entries.set('["channel","a"]', {
      queryHash: '["channel","a"]',
      queryKey: ['channel', 'a'],
      data: { value: 'from-idb' },
      dataUpdatedAt: Date.now() - 1000,
      persistedAt: Date.now() - 1000,
      buster: 'test',
    });

    const scope = createScope(['channel'], store);
    setupQueryPersistence({ queryClient, scopes: [scope] });

    // Trigger an 'added' event by fetching (prefetchQuery triggers added)
    void queryClient.prefetchQuery({
      queryKey: ['channel', 'a'],
      queryFn: () => new Promise(() => {}), // never resolves
    });

    // Let the IDB read promise resolve
    await Promise.resolve();
    await Promise.resolve();

    expect(queryClient.getQueryData(['channel', 'a'])).toEqual({
      value: 'from-idb',
    });
  });

  it('does not overwrite fresh fetch data with stale IDB read (race guard)', async () => {
    const queryClient = new QueryClient();
    const store = createMockStore();

    let resolveGet!: (value: PersistedQueryEntry | undefined) => void;
    store.get = vi.fn(
      () =>
        new Promise<PersistedQueryEntry | undefined>((resolve) => {
          resolveGet = resolve;
        })
    );

    const scope = createScope(['channel'], store);
    setupQueryPersistence({ queryClient, scopes: [scope] });

    // Trigger added event
    void queryClient.prefetchQuery({
      queryKey: ['channel', 'a'],
      queryFn: () => new Promise(() => {}),
    });

    await Promise.resolve();

    // Simulate fetch completing before IDB read resolves
    queryClient.setQueryData(['channel', 'a'], { value: 'fresh' });

    // Now resolve the IDB read with stale data
    resolveGet({
      queryHash: '["channel","a"]',
      queryKey: ['channel', 'a'],
      data: { value: 'stale-idb' },
      dataUpdatedAt: Date.now() - 60000,
      persistedAt: Date.now() - 60000,
      buster: 'test',
    });

    await Promise.resolve();
    await Promise.resolve();

    // Fresh data should not be overwritten
    expect(queryClient.getQueryData(['channel', 'a'])).toEqual({
      value: 'fresh',
    });
  });

  it('removes expired entries instead of restoring', async () => {
    const queryClient = new QueryClient();
    const store = createMockStore();
    const maxAgeMs = 1000;

    store.entries.set('["channel","old"]', {
      queryHash: '["channel","old"]',
      queryKey: ['channel', 'old'],
      data: { value: 'expired' },
      dataUpdatedAt: Date.now() - maxAgeMs - 1,
      persistedAt: Date.now() - maxAgeMs - 1,
      buster: 'test',
    });

    const scope = createScope(['channel'], store, { maxAgeMs });
    setupQueryPersistence({ queryClient, scopes: [scope] });

    void queryClient.prefetchQuery({
      queryKey: ['channel', 'old'],
      queryFn: () => new Promise(() => {}),
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(queryClient.getQueryData(['channel', 'old'])).toBeUndefined();
    expect(store.remove).toHaveBeenCalledWith('["channel","old"]');
  });

  it('removes buster-mismatched entries instead of restoring', async () => {
    const queryClient = new QueryClient();
    const store = createMockStore();

    store.entries.set('["channel","v"]', {
      queryHash: '["channel","v"]',
      queryKey: ['channel', 'v'],
      data: { value: 'old-version' },
      dataUpdatedAt: Date.now() - 1000,
      persistedAt: Date.now() - 1000,
      buster: 'old-buster',
    });

    const scope = createScope(['channel'], store, { buster: 'new-buster' });
    setupQueryPersistence({ queryClient, scopes: [scope] });

    void queryClient.prefetchQuery({
      queryKey: ['channel', 'v'],
      queryFn: () => new Promise(() => {}),
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(queryClient.getQueryData(['channel', 'v'])).toBeUndefined();
    expect(store.remove).toHaveBeenCalledWith('["channel","v"]');
  });

  it('stops persistence on unsubscribe', () => {
    const queryClient = new QueryClient();
    const store = createMockStore();
    const scope = createScope(['channel'], store);

    const unsubscribe = setupQueryPersistence({
      queryClient,
      scopes: [scope],
    });

    queryClient.setQueryData(['channel', 'a'], { value: 1 });
    expect(store.set).toHaveBeenCalledTimes(1);

    unsubscribe();

    queryClient.setQueryData(['channel', 'b'], { value: 2 });
    expect(store.set).toHaveBeenCalledTimes(1);
  });

  it('removes entry from store on query removal', () => {
    const queryClient = new QueryClient();
    const store = createMockStore();
    const scope = createScope(['channel'], store);

    setupQueryPersistence({ queryClient, scopes: [scope] });

    queryClient.setQueryData(['channel', 'a'], { value: 1 });
    expect(store.set).toHaveBeenCalledTimes(1);

    queryClient.removeQueries({ queryKey: ['channel', 'a'] });
    expect(store.remove).toHaveBeenCalledWith('["channel","a"]');
  });
});
