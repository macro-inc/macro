import { partialMatchKey } from '@tanstack/query-core';
import { QueryClient } from '@tanstack/solid-query';
import { describe, expect, it, vi } from 'vitest';
import { authKeys } from './auth/keys';
import { channelKeys } from './channel/keys';
import { messageKeys } from './messages/keys';
import { type PersistScope, setupQueryPersistence } from './persistence';
import type {
  PerQueryPersistence,
  PersistedQueryEntry,
} from './persistence/per-query-idb';
import {
  createQueryPersistenceScopes,
  shouldPersistChannelQuery,
} from './persistence-scopes';

vi.mock('@core/mobile/isNativeMobilePlatform', () => ({
  isNativeMobilePlatform: () => true,
}));
vi.mock('@core/util/cookies', () => ({ hasLoginCookie: () => true }));

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
    maxAge: { value: 7, unit: 'd' },
    buster: 'test',
    shouldPersist: (key) => partialMatchKey(key, prefix),
    ...overrides,
  };
}

describe('setupQueryPersistence', () => {
  it('allowlists persisted channel query families', () => {
    expect(shouldPersistChannelQuery(channelKeys.withID('a').queryKey)).toBe(
      false
    );
    expect(shouldPersistChannelQuery(channelKeys.listChannels.queryKey)).toBe(
      true
    );
    expect(
      shouldPersistChannelQuery(
        messageKeys.messages({ type: 'channel', id: 'a' }, null).queryKey
      )
    ).toBe(false);
    expect(shouldPersistChannelQuery(['channel', 'future-family', 'a'])).toBe(
      false
    );
  });

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

  it('does not restore or persist channel message queries', async () => {
    const queryClient = new QueryClient();
    const store = createMockStore();
    const scope = createScope(['channel'], store, {
      shouldPersist: shouldPersistChannelQuery,
    });
    const messageQueryKey = [
      'channel',
      'a',
      { loadAroundMessageId: null },
    ] as const;

    store.entries.set(JSON.stringify(messageQueryKey), {
      queryHash: JSON.stringify(messageQueryKey),
      queryKey: messageQueryKey,
      data: { value: 'from-idb' },
      dataUpdatedAt: Date.now() - 1000,
      persistedAt: Date.now() - 1000,
      buster: 'test',
    });

    setupQueryPersistence({ queryClient, scopes: [scope] });

    void queryClient.prefetchQuery({
      queryKey: messageQueryKey,
      queryFn: () => new Promise(() => {}),
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(store.get).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(messageQueryKey)).toBeUndefined();

    queryClient.setQueryData(messageQueryKey, { value: 'skip' });
    expect(store.set).not.toHaveBeenCalled();

    queryClient.setQueryData(channelKeys.listChannels.queryKey, {
      value: 'persist',
    });
    expect(store.set).toHaveBeenCalledTimes(1);
    expect(
      (store.set.mock.calls[0]![0] as PersistedQueryEntry).queryKey
    ).toEqual(channelKeys.listChannels.queryKey);
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

    const scope = createScope(['channel'], store, {
      maxAge: { value: maxAgeMs, unit: 'ms' },
    });
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

  it('restores entries regardless of age when the scope has no max age', async () => {
    const queryClient = new QueryClient();
    const store = createMockStore();
    const tenYearsAgo = Date.now() - 10 * 365 * 24 * 60 * 60 * 1000;

    store.entries.set('["identity","user"]', {
      queryHash: '["identity","user"]',
      queryKey: ['identity', 'user'],
      data: { authenticated: true },
      dataUpdatedAt: tenYearsAgo,
      persistedAt: tenYearsAgo,
      buster: 'test',
    });

    const scope = createScope(['identity'], store, { maxAge: undefined });
    setupQueryPersistence({ queryClient, scopes: [scope] });

    void queryClient.prefetchQuery({
      queryKey: ['identity', 'user'],
      queryFn: () => new Promise(() => {}),
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(queryClient.getQueryData(['identity', 'user'])).toEqual({
      authenticated: true,
    });
    expect(store.remove).not.toHaveBeenCalled();
  });

  it.each([
    { id: '', authenticated: false },
    { id: 'viewer', authenticated: false },
    { id: '', authenticated: true },
    { authenticated: true },
    { id: 42, authenticated: true },
    null,
  ])(
    'does not hydrate a non-identity native user-info record: %j',
    async (data) => {
      const queryClient = new QueryClient();
      const store = createMockStore();
      const queryKey = authKeys.userInfo.queryKey;
      const queryHash = JSON.stringify(queryKey);
      const scope = createQueryPersistenceScopes('test').find((scope) =>
        scope.shouldPersist(queryKey)
      )!;
      store.entries.set(queryHash, {
        queryHash,
        queryKey,
        data,
        dataUpdatedAt: Date.now(),
        persistedAt: Date.now(),
        buster: 'test',
      });
      const persistence = setupQueryPersistence({
        queryClient,
        scopes: [{ ...scope, store }],
      });
      await persistence.restoreQuery(queryKey);
      expect(queryClient.getQueryData(queryKey)).toBeUndefined();
      expect(store.remove).toHaveBeenCalledWith(queryHash);
      expect(store.set).not.toHaveBeenCalled();
      persistence.dispose();
      queryClient.clear();
    }
  );

  it('persists logout over the previous identity but treats that marker as a cache miss on restart', async () => {
    const store = createMockStore();
    const queryKey = authKeys.userInfo.queryKey;
    const queryHash = JSON.stringify(queryKey);
    const scope = {
      ...createQueryPersistenceScopes('test').find((scope) =>
        scope.shouldPersist(queryKey)
      )!,
      store,
    };
    const firstClient = new QueryClient();
    const first = setupQueryPersistence({
      queryClient: firstClient,
      scopes: [scope],
    });
    firstClient.setQueryData(queryKey, {
      id: 'old-viewer',
      authenticated: true,
    });
    firstClient.setQueryData(queryKey, { id: '', authenticated: false });
    expect(store.entries.get(queryHash)?.data).toEqual({
      id: '',
      authenticated: false,
    });
    first.dispose();
    firstClient.clear();
    const queryClient = new QueryClient();
    const restarted = setupQueryPersistence({ queryClient, scopes: [scope] });
    await restarted.restoreQuery(queryKey);
    expect(queryClient.getQueryData(queryKey)).toBeUndefined();
    expect(store.entries.has(queryHash)).toBe(false);
    restarted.dispose();
    queryClient.clear();
  });

  it('does not remove a new identity when an old logout marker finishes restoring', async () => {
    const queryClient = new QueryClient();
    const store = createMockStore();
    const read = Promise.withResolvers<PersistedQueryEntry | undefined>();
    store.get.mockReturnValue(read.promise);
    const queryKey = authKeys.userInfo.queryKey;
    const queryHash = JSON.stringify(queryKey);
    const scope = createQueryPersistenceScopes('test').find((scope) =>
      scope.shouldPersist(queryKey)
    )!;
    const persistence = setupQueryPersistence({
      queryClient,
      scopes: [{ ...scope, store }],
    });
    const restored = persistence.restoreQuery(queryKey);
    const identity = { id: 'new-viewer', authenticated: true };
    queryClient.setQueryData(queryKey, identity);
    read.resolve({
      queryHash,
      queryKey,
      data: { id: '', authenticated: false },
      dataUpdatedAt: Date.now(),
      persistedAt: Date.now(),
      buster: 'test',
    });
    await restored;
    expect(queryClient.getQueryData(queryKey)).toEqual(identity);
    expect(store.entries.get(queryHash)?.data).toEqual(identity);
    expect(store.remove).not.toHaveBeenCalled();
    persistence.dispose();
    queryClient.clear();
  });

  it('configures only native user-info persistence without an expiry', () => {
    const scopes = createQueryPersistenceScopes('test');
    const userInfoScope = scopes.find((scope) =>
      scope.shouldPersist(authKeys.userInfo.queryKey)
    );

    expect(userInfoScope).toBeDefined();
    expect(userInfoScope?.maxAge).toBeUndefined();
    expect(
      scopes
        .filter((scope) => scope !== userInfoScope)
        .every((scope) => scope.maxAge !== undefined)
    ).toBe(true);
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

    const persistence = setupQueryPersistence({
      queryClient,
      scopes: [scope],
    });

    queryClient.setQueryData(['channel', 'a'], { value: 1 });
    expect(store.set).toHaveBeenCalledTimes(1);

    persistence.dispose();

    queryClient.setQueryData(['channel', 'b'], { value: 2 });
    expect(store.set).toHaveBeenCalledTimes(1);
  });

  it('shares an awaitable restore without starting or waiting for a network fetch', async () => {
    const queryClient = new QueryClient();
    const store = createMockStore();
    const read = Promise.withResolvers<PersistedQueryEntry | undefined>();
    store.get.mockReturnValue(read.promise);
    const persistence = setupQueryPersistence({
      queryClient,
      scopes: [createScope(['identity'], store)],
    });
    const queryKey = ['identity', 'user'];
    const first = persistence.restoreQuery(queryKey);
    const second = persistence.restoreQuery(queryKey);
    expect(first).toBe(second);
    expect(queryClient.getQueryState(queryKey)?.fetchStatus).toBe('idle');
    void queryClient.prefetchQuery({
      queryKey,
      queryFn: () => new Promise(() => {}),
    });
    read.resolve({
      queryHash: JSON.stringify(queryKey),
      queryKey,
      data: { id: 'viewer' },
      dataUpdatedAt: Date.now(),
      persistedAt: Date.now(),
      buster: 'test',
    });
    await first;
    expect(store.get).toHaveBeenCalledOnce();
    expect(queryClient.getQueryData(queryKey)).toEqual({ id: 'viewer' });
    expect(queryClient.getQueryState(queryKey)?.fetchStatus).toBe('fetching');
    persistence.dispose();
    queryClient.clear();
  });

  it.each([
    'removed',
    'recreated',
    'disposed',
    'logged-out',
    'denied',
  ] as const)(
    'fences a pending restore when the query is %s',
    async (change) => {
      const queryClient = new QueryClient();
      const store = createMockStore();
      const read = Promise.withResolvers<PersistedQueryEntry | undefined>();
      store.get
        .mockReturnValueOnce(read.promise)
        .mockImplementation(() => new Promise(() => {}));
      let allowed = true;
      const persistence = setupQueryPersistence({
        queryClient,
        scopes: [
          createScope(['identity'], store, { shouldRestore: () => allowed }),
        ],
      });
      const queryKey = ['identity', 'user'];
      const pending = persistence.restoreQuery(queryKey);
      if (change === 'removed' || change === 'recreated')
        queryClient.removeQueries({ queryKey });
      if (change === 'recreated')
        queryClient.getQueryCache().build(queryClient, { queryKey });
      if (change === 'disposed') persistence.dispose();
      if (change === 'logged-out')
        queryClient.setQueryData(queryKey, { authenticated: false });
      if (change === 'denied') allowed = false;
      read.resolve({
        queryHash: JSON.stringify(queryKey),
        queryKey,
        data: { id: 'old-viewer' },
        dataUpdatedAt: Date.now(),
        persistedAt: Date.now(),
        buster: 'test',
      });
      await pending;
      expect(queryClient.getQueryData(queryKey)).toEqual(
        change === 'logged-out' ? { authenticated: false } : undefined
      );
      expect(store.set).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: { id: 'old-viewer' } })
      );
      persistence.dispose();
      queryClient.clear();
    }
  );

  it('does not remove a newer persisted value when an old read has the wrong buster', async () => {
    const queryClient = new QueryClient();
    const store = createMockStore();
    const read = Promise.withResolvers<PersistedQueryEntry | undefined>();
    store.get.mockReturnValue(read.promise);
    const persistence = setupQueryPersistence({
      queryClient,
      scopes: [createScope(['identity'], store)],
    });
    const queryKey = ['identity', 'user'];
    const pending = persistence.restoreQuery(queryKey);
    queryClient.setQueryData(queryKey, { id: 'new-viewer' });
    read.resolve({
      queryHash: JSON.stringify(queryKey),
      queryKey,
      data: { id: 'old-viewer' },
      dataUpdatedAt: 1,
      persistedAt: 1,
      buster: 'old-buster',
    });
    await pending;
    expect(queryClient.getQueryData(queryKey)).toEqual({ id: 'new-viewer' });
    expect(store.remove).not.toHaveBeenCalled();
    persistence.dispose();
    queryClient.clear();
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
