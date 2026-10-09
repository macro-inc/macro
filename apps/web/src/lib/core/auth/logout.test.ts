import { notificationKeys } from '@queries/notification/keys';
import { graphqlSoupKeys } from '@queries/soup/graphql/keys';
import { isCancelledError, QueryClient } from '@tanstack/solid-query';
import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { client, isTauri, navigate } = vi.hoisted(() => ({
  client: { current: undefined as QueryClient | undefined },
  isTauri: vi.fn(() => false),
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
vi.mock('@core/constant/servers', () => ({
  SERVER_HOSTS: { 'auth-logout': 'https://auth.example.com/oauth2/logout' },
}));
vi.mock('@core/util/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/util/platform')>()),
  isTauri,
}));
vi.mock('@solidjs/router', () => ({ useNavigate: () => navigate }));
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

import { clearLocalAuthSession, useLogout } from './logout';

beforeEach(() => {
  isTauri.mockReturnValue(false);
  navigate.mockReset();
});

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

describe('logout inside the Tauri shell', () => {
  it('ends the provider session in the background and lands on /login in place', async () => {
    const queryClient = new QueryClient();
    client.current = queryClient;
    isTauri.mockReturnValue(true);
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await createRoot(() => useLogout())();

    // A webview navigation to the provider would be handed to the system
    // browser by the navigation plugin, leaving the app signed in.
    expect(fetchMock).toHaveBeenCalledWith(
      'https://auth.example.com/oauth2/logout',
      expect.objectContaining({ credentials: 'include', mode: 'no-cors' })
    );
    expect(navigate).toHaveBeenCalledWith('/login');
    vi.unstubAllGlobals();
    queryClient.clear();
  });
});
