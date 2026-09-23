import 'fake-indexeddb/auto';
import { render } from '@solidjs/testing-library';
import { QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { createComponent, createEffect } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authKeys } from '../../auth/keys';
import { useUserInfoQuery } from '../../auth/user-info';
import { queryClient } from '../../client';
import type { PersistedQueryEntry } from '../../persistence/per-query-idb';
import { documentContext, freshContext } from './offline-context.test-helpers';
import {
  clearOfflineDocumentContexts,
  offlineDocumentContextCache,
} from './offline-context-runtime';
import { fetchSyncDocumentOpenContext } from './sync-document-context';

const mocks = vi.hoisted(() => ({
  native: true,
  login: true,
  restore: vi.fn(),
  userInfo: vi.fn(),
  snapshot: vi.fn(),
  bundle: vi.fn(),
  location: vi.fn(),
}));
vi.mock('@core/mobile/isNativeMobilePlatform', () => ({
  isNativeMobilePlatform: () => mocks.native,
}));
vi.mock('@core/util/cookies', () => ({ hasLoginCookie: () => mocks.login }));
vi.mock('@core/auth/push-registration-lifecycle', () => ({
  syncPushRegistrations: vi.fn(),
}));
vi.mock('@core/context/user-info-gate', () => ({
  enableUserInfoQuery: vi.fn(),
}));
vi.mock('@service-auth/client', () => ({
  authServiceClient: { getLegacyUserPermissions: mocks.userInfo },
}));
vi.mock('@macro-inc/collaboration/collab/snapshot-store', () => ({
  LORO_SNAPSHOT_DB_NAME: 'test-snapshots',
  IDBSnapshotStore: class {
    load = mocks.snapshot;
  },
}));
vi.mock('./documentLoadBundle', () => ({
  documentLoadQueryOptions: () => ({
    queryKey: ['test-bundle'],
    queryFn: mocks.bundle,
  }),
  fetchDocumentLoadBundle: async () => ok(await mocks.bundle()),
}));
vi.mock('../document-location', () => ({
  fetchDocumentLocation: mocks.location,
  waitForDocumentSyncServiceReady: vi.fn(),
}));
vi.mock('../../client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  const { setupQueryPersistence } = await import('../../persistence');
  const { createQueryPersistenceScopes } = await import(
    '../../persistence-scopes'
  );
  const { authKeys } = await import('../../auth/keys');
  const userInfoScope = createQueryPersistenceScopes('test').find((scope) =>
    scope.shouldPersist(authKeys.userInfo.queryKey)
  )!;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const queryPersistence = setupQueryPersistence({
    queryClient,
    scopes: [
      {
        ...userInfoScope,
        store: {
          get: mocks.restore,
          set: vi.fn(),
          remove: vi.fn(),
          flush: async () => {},
        },
      },
    ],
  });
  return { queryClient, queryPersistence };
});

const identity = { id: 'viewer-a', authenticated: true };
const entry: PersistedQueryEntry = {
  queryKey: authKeys.userInfo.queryKey,
  queryHash: JSON.stringify(authKeys.userInfo.queryKey),
  data: identity,
  dataUpdatedAt: 1,
  persistedAt: 1,
  buster: 'test',
};

beforeEach(async () => {
  vi.resetAllMocks();
  mocks.native = true;
  mocks.login = true;
  queryClient.clear();
  await clearOfflineDocumentContexts();
  queryClient.setQueryData(authKeys.userInfo.queryKey, identity);
  await offlineDocumentContextCache.write(
    offlineDocumentContextCache.capture()!,
    documentContext
  );
  queryClient.removeQueries({ queryKey: authKeys.userInfo.queryKey });
  mocks.restore.mockClear();
  mocks.snapshot.mockResolvedValue(new Uint8Array([1]));
});
afterEach(async () => {
  queryClient.clear();
  await clearOfflineDocumentContexts();
});

const expectCachedOpen = async (
  opening: ReturnType<typeof fetchSyncDocumentOpenContext>
) => {
  const result = await opening;
  expect(result.isOk()).toBe(true);
  expect(result._unsafeUnwrap().fromCache).toBe(true);
  expect(mocks.bundle).not.toHaveBeenCalled();
  expect(mocks.location).not.toHaveBeenCalled();
};

describe('native document identity bootstrap', () => {
  it('waits for identity restoration without waiting for a stalled auth fetch', async () => {
    const restored = Promise.withResolvers<PersistedQueryEntry | undefined>();
    mocks.restore.mockReturnValue(restored.promise);
    void queryClient.prefetchQuery({
      queryKey: authKeys.userInfo.queryKey,
      queryFn: () => new Promise(() => {}),
    });
    const opening = fetchSyncDocumentOpenContext('doc-1');
    expect(mocks.snapshot).not.toHaveBeenCalled();
    restored.resolve(entry);
    await expectCachedOpen(opening);
    expect(mocks.restore).toHaveBeenCalledOnce();
    expect(mocks.userInfo).not.toHaveBeenCalled();
    expect(
      queryClient.getQueryState(authKeys.userInfo.queryKey)?.fetchStatus
    ).toBe('fetching');
  });

  it('starts identity restoration even when no user-info observer has mounted', async () => {
    mocks.restore.mockResolvedValue(entry);
    await expectCachedOpen(fetchSyncDocumentOpenContext('doc-1'));
    expect(mocks.userInfo).not.toHaveBeenCalled();
  });

  it.each(['missing', 'unreadable'] as const)(
    'fetches identity when persistence is %s',
    async (state) => {
      if (state === 'unreadable')
        mocks.restore.mockRejectedValue(new Error('IDB unavailable'));
      else mocks.restore.mockResolvedValue(undefined);
      mocks.userInfo.mockResolvedValue(ok(identity));
      await expectCachedOpen(fetchSyncDocumentOpenContext('doc-1'));
      expect(mocks.userInfo).toHaveBeenCalledOnce();
    }
  );

  it('does not publish a persisted logout stub or clear a new login cookie before fetching identity', async () => {
    const signedOut = { id: '', authenticated: false };
    const userInfo = ok(identity);
    const response = Promise.withResolvers<typeof userInfo>();
    mocks.restore.mockResolvedValue({ ...entry, data: signedOut });
    mocks.userInfo.mockReturnValue(response.promise);
    const restoredSignOut = vi.fn();
    // Model Root's useSyncLoginCookie: a successful signed-out query result
    // clears the cookie even if that result came from IDB, not the server.
    const stop = queryClient.getQueryCache().subscribe(({ query }) => {
      if (
        query.queryHash === entry.queryHash &&
        query.state.status === 'success' &&
        queryClient.getQueryData<typeof signedOut>(authKeys.userInfo.queryKey)
          ?.authenticated === false
      ) {
        restoredSignOut();
        mocks.login = false;
      }
    });
    try {
      const opening = fetchSyncDocumentOpenContext('doc-1');
      await vi.waitFor(() => expect(mocks.userInfo).toHaveBeenCalledOnce());
      expect(mocks.login).toBe(true);
      expect(restoredSignOut).not.toHaveBeenCalled();
      expect(
        queryClient.getQueryData(authKeys.userInfo.queryKey)
      ).toBeUndefined();
      response.resolve(userInfo);
      await expectCachedOpen(opening);
      expect(restoredSignOut).not.toHaveBeenCalled();
    } finally {
      stop();
      response.resolve(userInfo);
    }
  });

  it('fetches fresh identity instead of reusing an in-memory logout stub', async () => {
    queryClient.setQueryData(authKeys.userInfo.queryKey, {
      id: '',
      authenticated: false,
    });
    mocks.userInfo.mockResolvedValue(ok(identity));
    await expectCachedOpen(fetchSyncDocumentOpenContext('doc-1'));
    expect(mocks.userInfo).toHaveBeenCalledOnce();
  });

  it('replaces an observed logout stub after a new login without clearing its cookie', async () => {
    const signedOut = { id: '', authenticated: false };
    const userInfo = ok(identity);
    const response = Promise.withResolvers<typeof userInfo>();
    mocks.login = false;
    mocks.userInfo
      .mockResolvedValueOnce(ok(signedOut))
      .mockReturnValue(response.promise);
    const view = render(() =>
      createComponent(QueryClientProvider, {
        client: queryClient,
        get children() {
          const query = useUserInfoQuery();
          createEffect(() => {
            if (query.isSuccess)
              mocks.login = query.data.authenticated ?? false;
          });
          return null;
        },
      })
    );
    try {
      await vi.waitFor(() =>
        expect(
          queryClient.getQueryState(authKeys.userInfo.queryKey)?.fetchStatus
        ).toBe('idle')
      );
      expect(queryClient.getQueryData(authKeys.userInfo.queryKey)).toEqual(
        signedOut
      );
      mocks.login = true;
      const opening = fetchSyncDocumentOpenContext('doc-1');
      await vi.waitFor(() => expect(mocks.userInfo).toHaveBeenCalledTimes(2));
      expect(mocks.login).toBe(true);
      response.resolve(userInfo);
      await expectCachedOpen(opening);
    } finally {
      view.unmount();
      response.resolve(userInfo);
    }
  });

  it('fails closed when the fresh auth response confirms sign-out', async () => {
    const signedOut = { id: '', authenticated: false };
    mocks.restore.mockResolvedValue({ ...entry, data: signedOut });
    mocks.userInfo.mockResolvedValue(ok(signedOut));
    const result = await fetchSyncDocumentOpenContext('doc-1');
    expect(mocks.userInfo).toHaveBeenCalledOnce();
    expect(result.isErr()).toBe(true);
    expect(mocks.snapshot).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(authKeys.userInfo.queryKey)).toEqual(
      signedOut
    );
  });

  it('keeps the fast path when identity is already available', async () => {
    queryClient.setQueryData(authKeys.userInfo.queryKey, identity);
    mocks.restore.mockClear();
    await expectCachedOpen(fetchSyncDocumentOpenContext('doc-1'));
    expect(mocks.restore).not.toHaveBeenCalled();
    expect(mocks.userInfo).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'fences a load across logout (new login: %s)',
    async (relogin) => {
      const restored = Promise.withResolvers<PersistedQueryEntry | undefined>();
      mocks.restore.mockReturnValue(restored.promise);
      const opening = fetchSyncDocumentOpenContext('doc-1');
      mocks.login = false;
      await clearOfflineDocumentContexts();
      queryClient.setQueryData(authKeys.userInfo.queryKey, {
        authenticated: false,
      });
      if (relogin) {
        mocks.login = true;
        queryClient.setQueryData(authKeys.userInfo.queryKey, {
          id: 'viewer-b',
          authenticated: true,
        });
      }
      restored.resolve(entry);
      expect((await opening)._unsafeUnwrapErr()).toEqual([
        { code: 'UNAUTHORIZED', message: 'Unauthorized access' },
      ]);
      expect(mocks.snapshot).not.toHaveBeenCalled();
      expect(mocks.bundle).not.toHaveBeenCalled();
      expect(queryClient.getQueryData(authKeys.userInfo.queryKey)).toEqual(
        relogin
          ? { id: 'viewer-b', authenticated: true }
          : { authenticated: false }
      );
    }
  );

  it('fences a first-login auth request that completes after logout', async () => {
    const userInfo = ok(identity);
    const response = Promise.withResolvers<typeof userInfo>();
    mocks.userInfo.mockReturnValue(response.promise);
    const opening = fetchSyncDocumentOpenContext('doc-1');
    await vi.waitFor(() => expect(mocks.userInfo).toHaveBeenCalledOnce());
    mocks.login = false;
    await clearOfflineDocumentContexts();
    queryClient.setQueryData(authKeys.userInfo.queryKey, {
      authenticated: false,
    });
    response.resolve(userInfo);
    expect((await opening).isErr()).toBe(true);
    expect(mocks.snapshot).not.toHaveBeenCalled();
    expect(mocks.bundle).not.toHaveBeenCalled();
  });

  it('fails closed without a login cookie or a confirmed identity', async () => {
    mocks.login = false;
    expect((await fetchSyncDocumentOpenContext('doc-1')).isErr()).toBe(true);
    expect(mocks.restore).not.toHaveBeenCalled();
    expect(mocks.userInfo).not.toHaveBeenCalled();
    mocks.login = true;
    mocks.userInfo.mockResolvedValue(
      err([{ code: 'NETWORK_ERROR', message: 'Offline' }])
    );
    expect((await fetchSyncDocumentOpenContext('doc-1')).isErr()).toBe(true);
    expect(mocks.bundle).not.toHaveBeenCalled();
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });

  it('preserves the non-native network path without identity hydration', async () => {
    mocks.native = false;
    mocks.bundle.mockResolvedValue(freshContext);
    mocks.location.mockResolvedValue(
      ok({ type: 'syncServiceContent', content: { state: 'ready' } })
    );
    expect(
      (await fetchSyncDocumentOpenContext('doc-1'))._unsafeUnwrap().fromCache
    ).toBe(false);
    expect(mocks.restore).not.toHaveBeenCalled();
    expect(mocks.userInfo).not.toHaveBeenCalled();
  });
});
