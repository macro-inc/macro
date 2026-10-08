import { notificationKeys } from '@queries/notification/keys';
import { graphqlSoupKeys } from '@queries/soup/graphql/keys';
import { isCancelledError, QueryClient } from '@tanstack/solid-query';
import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';

const { client, navigate } = vi.hoisted(() => ({
  client: { current: undefined as QueryClient | undefined },
  navigate: vi.fn(),
}));
vi.mock('@queries/client', () => ({
  get queryClient() {
    return client.current;
  },
}));
vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({ track: vi.fn(), reset: vi.fn() }),
}));
vi.mock('@solidjs/router', () => ({ useNavigate: () => navigate }));
vi.mock('@ui', () => ({ confirmDialog: vi.fn(async () => false) }));
vi.mock('@queries/email/local-drafts', () => ({
  clearLocalDrafts: vi.fn(async () => {}),
  flushLocalDrafts: vi.fn(async () => {}),
  listLocalDrafts: vi.fn(async () => []),
}));
vi.mock('@core/constant/servers', () => ({ SERVER_HOSTS: {} }));
vi.mock('@core/mobile/isNativeMobilePlatform', () => ({
  isNativeMobilePlatform: vi.fn(() => false),
}));
vi.mock('@core/util/cookies', () => ({ syncLoginStorage: vi.fn() }));
vi.mock('@graphql-cache/lifecycle', () => ({
  clearRegisteredCaches: vi.fn(async () => {}),
}));
vi.mock('@queries/auth/user-info', () => ({
  authKeys: {
    userInfo: { queryKey: ['auth', 'user-info'] },
    aiBillingSummary: { queryKey: ['auth', 'ai-billing-summary'] },
  },
}));
vi.mock('@queries/storage/document-cache', () => ({
  clearDocumentQueryCache: vi.fn(),
}));
vi.mock('@service-auth/client', () => ({
  authServiceClient: { logout: vi.fn() },
}));
vi.mock('./push-registration-lifecycle', () => ({
  unregisterPushRegistrationsForLogout: vi.fn(async () => {}),
}));

import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import {
  clearLocalDrafts,
  flushLocalDrafts,
  listLocalDrafts,
} from '@queries/email/local-drafts';
import { authServiceClient } from '@service-auth/client';
import { confirmDialog } from '@ui';
import { clearLocalAuthSession, useLogout } from './logout';

describe('logout notification cache isolation', () => {
  it('retires pending Done buckets and rotates the display-intent session', async () => {
    const queryClient = new QueryClient();
    client.current = queryClient;
    const first = graphqlSoupKeys.pendingDone('alice', 'old-session').queryKey;
    const second = graphqlSoupKeys.pendingDone('bob', 'older-session').queryKey;
    queryClient.setQueryData(first, [{ entityId: 'shared' }]);
    queryClient.setQueryData(second, [{ entityId: 'shared' }]);
    queryClient.setQueryData(
      graphqlSoupKeys.doneSession.queryKey,
      'old-session'
    );
    await clearLocalAuthSession();
    expect(clearLocalDrafts).toHaveBeenCalled();
    expect(queryClient.getQueryData(first)).toBeUndefined();
    expect(queryClient.getQueryData(second)).toBeUndefined();
    expect(
      queryClient.getQueryData(graphqlSoupKeys.doneSession.queryKey)
    ).toEqual(expect.any(String));
    expect(
      queryClient.getQueryData(graphqlSoupKeys.doneSession.queryKey)
    ).not.toBe('old-session');
    queryClient.clear();
  });

  it('cancels an old in-flight snapshot even when its transport ignores abort', async () => {
    const queryClient = new QueryClient();
    client.current = queryClient;
    const queryKey = notificationKeys.user({ limit: 500 }).queryKey;
    let resolveTransport!: (value: { owner: string }) => void;
    const transport = new Promise<{ owner: string }>((resolve) => {
      resolveTransport = resolve;
    });
    const request = queryClient
      .fetchQuery({ queryKey, queryFn: () => transport, retry: false })
      .catch((error: unknown) => error);
    expect(queryClient.getQueryState(queryKey)?.fetchStatus).toBe('fetching');

    await clearLocalAuthSession();
    expect(isCancelledError(await request)).toBe(true);
    expect(queryClient.getQueryData(queryKey)).toBeUndefined();

    queryClient.setQueryData(queryKey, { owner: 'bob' });
    resolveTransport({ owner: 'alice' });
    await transport;
    await Promise.resolve();
    expect(queryClient.getQueryData(queryKey)).toEqual({ owner: 'bob' });
    queryClient.clear();
  });

  it('evicts account notification snapshots and preferences before another login', async () => {
    const queryClient = new QueryClient();
    client.current = queryClient;
    const keys = [
      notificationKeys.user({ limit: 500 }).queryKey,
      notificationKeys.entity({ eventItemId: 'reminder-1' }).queryKey,
      notificationKeys.unsubscribes.queryKey,
      notificationKeys.preferences.queryKey,
    ];
    for (const key of keys) queryClient.setQueryData(key, { owner: 'alice' });
    await clearLocalAuthSession();
    for (const key of keys)
      expect(queryClient.getQueryData(key)).toBeUndefined();
    queryClient.clear();
  });
});

describe('local draft logout warning', () => {
  it('reloads the native login document only after local cleanup and navigation', async () => {
    const order: string[] = [];
    client.current = new QueryClient();
    vi.mocked(isNativeMobilePlatform).mockReturnValue(true);
    vi.mocked(clearLocalDrafts).mockImplementationOnce(async () => {
      order.push('clear');
    });
    navigate.mockImplementationOnce(() => {
      order.push('navigate');
    });
    const reload = vi.fn(() => {
      order.push('reload');
    });
    vi.stubGlobal('window', { location: { reload } });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response())
    );
    const { logout, dispose } = createRoot((dispose) => ({
      logout: useLogout(),
      dispose,
    }));
    try {
      await logout();
      expect(order).toEqual(['clear', 'navigate', 'reload']);
      expect(navigate).toHaveBeenLastCalledWith('/login');
      expect(reload).toHaveBeenCalledOnce();
    } finally {
      dispose();
      vi.mocked(isNativeMobilePlatform).mockReturnValue(false);
      vi.mocked(authServiceClient.logout).mockClear();
      vi.unstubAllGlobals();
      client.current.clear();
    }
  });
  it('allows cancelling logout when drafts have unsynced changes', async () => {
    vi.mocked(listLocalDrafts).mockResolvedValueOnce([
      { status: 'failed' },
    ] as Awaited<ReturnType<typeof listLocalDrafts>>);
    const { logout, dispose } = createRoot((dispose) => ({
      logout: useLogout(),
      dispose,
    }));
    try {
      await logout();
      expect(confirmDialog).toHaveBeenLastCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('1 draft(s)'),
        }),
        expect.anything()
      );
      expect(authServiceClient.logout).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it('offers a warning and cancellation when local storage cannot be checked', async () => {
    vi.mocked(flushLocalDrafts).mockRejectedValueOnce(
      new Error('Disk unavailable')
    );
    const { logout, dispose } = createRoot((dispose) => ({
      logout: useLogout(),
      dispose,
    }));
    try {
      await logout();
      expect(confirmDialog).toHaveBeenLastCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('could not be checked'),
        }),
        expect.anything()
      );
      expect(authServiceClient.logout).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });
});
