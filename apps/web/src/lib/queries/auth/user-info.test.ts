import { QueryClient, QueryObserver } from '@tanstack/solid-query';
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

import { calendarKeys } from '../calendar/keys';
import { subscribeToTeamCalendarReset } from '../calendar/team-cache';
import { calendarTeamKeys } from '../calendar/team-keys';
import { graphqlSoupKeys } from '../soup/graphql/keys';
import { authKeys } from './keys';
import { invalidateAllAfterLogin } from './user-info';

afterEach(() => {
  client.current?.clear();
});

describe('login display-intent lifetime', () => {
  it('removes team payloads and closes detached selections before a replacement session refetch settles', async () => {
    const queryClient = new QueryClient();
    client.current = queryClient;
    const identity = { userId: 'old-viewer', authenticated: true };
    queryClient.setQueryData(authKeys.userInfo.queryKey, identity);
    const teamKeys = [
      calendarTeamKeys.events(
        { userId: 'old-viewer', teamId: 'old-team' },
        undefined
      ).queryKey,
      calendarKeys.teamOutOfOffice('old-viewer', undefined, 'old-team')
        .queryKey,
    ];
    const observers = teamKeys.map((queryKey) => {
      queryClient.setQueryData(queryKey, { title: 'Old private title' });
      return new QueryObserver(queryClient, {
        queryKey,
        queryFn: () => new Promise<never>(() => {}),
        staleTime: Infinity,
      });
    });
    const subscriptions = observers.map((observer) =>
      observer.subscribe(() => {})
    );
    const closeSelection = vi.fn();
    const unsubscribeReset = subscribeToTeamCalendarReset(closeSelection);

    const invalidated = invalidateAllAfterLogin();

    // User-info can still show the old viewer while its auth request settles.
    expect(queryClient.getQueryData(authKeys.userInfo.queryKey)).toBe(identity);
    for (const observer of observers)
      expect(observer.getCurrentResult().data).toBeUndefined();
    expect(closeSelection).toHaveBeenCalledTimes(2);
    unsubscribeReset();
    subscriptions.forEach((unsubscribe) => unsubscribe());
    await queryClient.cancelQueries();
    await invalidated;
  });

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
