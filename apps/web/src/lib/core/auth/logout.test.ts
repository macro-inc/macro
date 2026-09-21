import { notificationKeys } from '@queries/notification/keys';
import { QueryClient } from '@tanstack/solid-query';
import { describe, expect, it, vi } from 'vitest';

const { client } = vi.hoisted(() => ({
  client: { current: undefined as QueryClient | undefined },
}));
vi.mock('@queries/client', () => ({
  get queryClient() {
    return client.current;
  },
}));
vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: vi.fn(),
}));
vi.mock('@core/constant/servers', () => ({ SERVER_HOSTS: {} }));
vi.mock('@core/mobile/isNativeMobilePlatform', () => ({
  isNativeMobilePlatform: () => false,
}));
vi.mock('@core/util/cookies', () => ({ syncLoginStorage: vi.fn() }));
vi.mock('@graphql-cache/lifecycle', () => ({
  clearRegisteredCaches: vi.fn(async () => {}),
}));
vi.mock('@queries/auth/user-info', () => ({
  authKeys: { userInfo: { queryKey: ['auth', 'user-info'] } },
}));
vi.mock('@queries/storage/document-cache', () => ({
  clearDocumentQueryCache: vi.fn(),
}));
vi.mock('@service-auth/client', () => ({
  authServiceClient: { logout: vi.fn() },
}));
vi.mock('./push-registration-lifecycle', () => ({
  unregisterPushRegistrationsForLogout: vi.fn(),
}));

import { clearLocalAuthSession } from './logout';

describe('logout notification cache isolation', () => {
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
