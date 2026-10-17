import { publishRefreshOutcome } from '@core/auth/refresh-outcome';
import { sessionStatus } from '@core/auth/session';
import { cleanup, render, waitFor } from '@solidjs/testing-library';
import {
  QueryClientProvider,
  type QueryKey,
  useQuery,
} from '@tanstack/solid-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { authKeys } from './auth/keys';
import { botKeys } from './bots/keys';
import { channelKeys } from './channel/keys';
import { queryClient } from './client';
import { historyKeys } from './history/keys';
import { notificationKeys } from './notification/keys';
import { establishesSession } from './session-gate';
import { soupKeys } from './soup/keys';
import { databasesKeys, formsKeys } from './storage/keys';
import { teamKeys } from './team/keys';

afterEach(() => {
  cleanup();
  publishRefreshOutcome('reset');
  queryClient.clear();
});

describe('app queryClient session binding', () => {
  it('derives the session from the user-info query', () => {
    expect(sessionStatus()).toBe('signed-out');

    queryClient.setQueryData(authKeys.userInfo.queryKey, {
      authenticated: true,
      id: 'macro|user@example.com',
    });
    expect(sessionStatus()).toBe('signed-in');

    queryClient.setQueryData(authKeys.userInfo.queryKey, {
      authenticated: false,
    });
    expect(sessionStatus()).toBe('signed-out');
  });

  it('expires on a rejected refresh even while user-info holds the old identity', () => {
    queryClient.setQueryData(authKeys.userInfo.queryKey, {
      authenticated: true,
      id: 'macro|user@example.com',
    });
    publishRefreshOutcome('rejected');
    expect(sessionStatus()).toBe('expired');
  });

  it('recovers when a fresh user-info fetch confirms the session', async () => {
    queryClient.setQueryData(authKeys.userInfo.queryKey, {
      authenticated: true,
      id: 'macro|user@example.com',
    });
    publishRefreshOutcome('rejected');

    await queryClient.fetchQuery({
      queryKey: authKeys.userInfo.queryKey,
      queryFn: async () => ({
        authenticated: true,
        id: 'macro|user@example.com',
      }),
      staleTime: 0,
    });
    expect(sessionStatus()).toBe('signed-in');
  });

  // What the root providers mount on the signed-out welcome page.
  const welcomePageKeys: Record<string, QueryKey> = {
    notifications: notificationKeys.user({ limit: 20 }).queryKey,
    unsubscribes: notificationKeys.unsubscribes.queryKey,
    team: teamKeys.currentTeam.queryKey,
    history: historyKeys.list.queryKey,
    soupItems: [...soupKeys.items._def, {}, {}],
    channels: channelKeys.listChannels.queryKey,
    channelActivity: channelKeys.activity.queryKey,
    bots: botKeys.list.queryKey,
    databases: databasesKeys.list.queryKey,
    forms: formsKeys.list.queryKey,
  };
  const enabledFor = (queryKey: QueryKey) =>
    queryClient.defaultQueryOptions({ queryKey, queryFn: async () => null })
      .enabled;

  it.each(Object.entries(welcomePageKeys))(
    'holds %s for a signed-out visitor and runs it once signed in',
    (_name, queryKey) => {
      expect(sessionStatus()).toBe('signed-out');
      expect(enabledFor(queryKey)).toBe(false);

      queryClient.setQueryData(authKeys.userInfo.queryKey, {
        authenticated: true,
        id: 'macro|user@example.com',
      });
      expect(enabledFor(queryKey)).not.toBe(false);
    }
  );

  it('leaves queries that serve shared links to a visitor', () => {
    expect(enabledFor(formsKeys.detail('form-1').queryKey)).not.toBe(false);
    expect(enabledFor(channelKeys.withID('channel-1').queryKey)).not.toBe(
      false
    );
  });

  it('settles when user-info fails with other queries mounted', async () => {
    const userInfo = vi.fn(async (): Promise<{ authenticated: boolean }> => {
      throw new Error('400');
    });
    const other = vi.fn(async () => 'public');
    let renders = 0;
    function View() {
      useQuery(() => ({
        queryKey: authKeys.userInfo.queryKey,
        queryFn: userInfo,
        retry: false,
        meta: establishesSession,
      }));
      const doc = useQuery(() => ({
        queryKey: ['public-doc'],
        queryFn: other,
      }));
      return (
        <>
          {(() => {
            renders++;
            return doc.status;
          })()}
        </>
      );
    }
    render(() => (
      <QueryClientProvider client={queryClient}>
        <View />
        <View />
      </QueryClientProvider>
    ));

    await waitFor(() => expect(userInfo).toHaveBeenCalledOnce());
    await waitFor(() => expect(other).toHaveBeenCalledOnce());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(renders).toBeLessThan(10);
  });
});
