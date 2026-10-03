import { QueryClient } from '@tanstack/solid-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

const client = vi.hoisted(() => ({
  current: undefined as QueryClient | undefined,
}));
vi.mock('../client', () => ({
  get queryClient() {
    return client.current;
  },
  queryPersistence: { restoreQuery: vi.fn() },
}));
vi.mock('@core/auth/push-registration-lifecycle', () => ({
  syncPushRegistrations: vi.fn(),
}));
vi.mock('@core/context/user-info-gate', () => ({
  enableUserInfoQuery: vi.fn(),
}));
vi.mock('@core/util/cookies', () => ({ hasLoginCookie: () => true }));
vi.mock('@service-auth/client', () => ({ authServiceClient: {} }));

import { graphqlSoupKeys } from '../soup/graphql/keys';
import { authKeys } from './keys';
import { invalidateAllAfterLogin } from './user-info';

afterEach(() => {
  client.current?.clear();
});

describe('login display-intent lifetime', () => {
  it('retires old intent even when native login keeps the same viewer and mounted app', async () => {
    const queryClient = new QueryClient();
    client.current = queryClient;
    const identity = { userId: 'viewer', authenticated: true };
    queryClient.setQueryData(authKeys.userInfo.queryKey, identity);
    queryClient.setQueryData(
      graphqlSoupKeys.doneSession.queryKey,
      'previous-session'
    );
    const previousKey = graphqlSoupKeys.pendingDone(
      'viewer',
      'previous-session'
    ).queryKey;
    queryClient.setQueryData(previousKey, [{ done: true }]);

    await invalidateAllAfterLogin();

    expect(queryClient.getQueryData(previousKey)).toBeUndefined();
    expect(queryClient.getQueryData(authKeys.userInfo.queryKey)).toBe(identity);
    expect(
      queryClient.getQueryData(graphqlSoupKeys.doneSession.queryKey)
    ).toEqual(expect.any(String));
    expect(
      queryClient.getQueryData(graphqlSoupKeys.doneSession.queryKey)
    ).not.toBe('previous-session');
  });
});
