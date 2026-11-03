import { toast } from '@core/component/Toast/Toast';
import { createNoopCacheHost } from '@graphql-cache/host/noop-host';
import { createRetirableCacheHost } from '@graphql-cache/host/retirable-host';
import { createTauriCacheHost } from '@graphql-cache/host/tauri-host';
import type { CacheHost } from '@graphql-cache/host/types';
import {
  clearRegisteredCaches,
  recordSessionCacheWrite,
  registerCacheHost,
} from '@graphql-cache/lifecycle';
import {
  beginCacheWriteSession,
  captureCacheWriteSession,
  endCacheWriteSession,
} from '@graphql-cache/session-writes';
import { prepareCrmContactEdit } from '@service-storage/crm-contact-edit';
import { QueryClient, QueryObserver } from '@tanstack/solid-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

const soup = vi.hoisted(() => ({
  host: undefined as CacheHost | undefined,
  invoke: vi.fn(),
}));
vi.mock('@core/component/Toast/Toast', () => ({ toast: { failure: vi.fn() } }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: soup.invoke }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async () => () => {}),
  emit: vi.fn(async () => {}),
}));

const client = vi.hoisted(() => ({
  current: undefined as QueryClient | undefined,
}));
vi.mock('../client', () => ({
  get queryClient() {
    return client.current;
  },
  queryPersistence: { restoreQuery: vi.fn() },
}));
vi.mock('@service-storage/graphql-soup', () => {
  const client = {};
  const host = {};
  return {
    getGraphqlSoupClient: () => client,
    getGraphqlSoupCacheHost: () => soup.host ?? host,
    resetGraphqlPresenceRequests: vi.fn(),
  };
});
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
      calendarTeamKeys.sharing({ userId: 'old-viewer', teamId: 'old-team' })
        .queryKey,
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

it('retires contact handles on true-to-true login with unchanged client and host', async () => {
  client.current = new QueryClient();
  await beginCacheWriteSession(async () => {}).ready;
  const old = prepareCrmContactEdit();
  expect(old.isCurrent()).toBe(true);
  const replacing = invalidateAllAfterLogin();
  expect(old.isCurrent()).toBe(false);
  const during = prepareCrmContactEdit();
  await replacing;
  expect(old.isCurrent()).toBe(false);
  expect(during.isCurrent()).toBe(false);
  expect(prepareCrmContactEdit().isCurrent()).toBe(true);
});

it('drains admitted writes before a replacement identity refetch', async () => {
  client.current = new QueryClient();
  await beginCacheWriteSession(async () => {}).ready;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const admitted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const writing = captureCacheWriteSession().run(async () => {
    started();
    await gate;
  });
  await admitted;
  const refetch = vi.spyOn(client.current, 'invalidateQueries');
  const replacing = invalidateAllAfterLogin();
  expect(refetch).not.toHaveBeenCalled();
  release();
  await Promise.all([writing, replacing]);
  expect(refetch).toHaveBeenCalledOnce();
});

it('does not reopen or refetch an older login after logout wins the transition', async () => {
  client.current = new QueryClient();
  await beginCacheWriteSession(async () => {}).ready;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const admitted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const writing = captureCacheWriteSession().run(async () => {
    started();
    await gate;
  });
  await admitted;
  const refetch = vi.spyOn(client.current, 'invalidateQueries');
  const replacing = invalidateAllAfterLogin();
  const ending = endCacheWriteSession(async () => {});
  release();
  await Promise.all([writing, replacing, ending]);
  expect(refetch).not.toHaveBeenCalled();
  expect(prepareCrmContactEdit().isCurrent()).toBe(false);
});

it('allows only the latest overlapping login to refetch', async () => {
  client.current = new QueryClient();
  const refetch = vi.spyOn(client.current, 'invalidateQueries');
  await Promise.all([invalidateAllAfterLogin(), invalidateAllAfterLogin()]);
  expect(refetch).toHaveBeenCalledOnce();
  expect(prepareCrmContactEdit().isCurrent()).toBe(true);
});

it.each(['same-viewer', 'new-viewer'])(
  'removes the old native contact and preserves queued drafts on %s login',
  async (viewer) => {
    client.current = new QueryClient();
    await beginCacheWriteSession(async () => {}).ready;
    soup.invoke.mockResolvedValue(null);
    const host = createTauriCacheHost({ scope: 'contact-replacement-test' });
    soup.host = host;
    const unregister = registerCacheHost(host);
    await host.readQuery({ query: '{ warm }' });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started!: () => void;
    const admitted = new Promise<void>((resolve) => {
      started = resolve;
    });
    client.current.setQueryData(authKeys.userInfo.queryKey, {
      userId: 'same-viewer',
      authenticated: true,
    });
    const stored = new Set<string>();
    const drafts: unknown[] = [];
    soup.invoke.mockImplementation(
      async (command: string, args?: { keys?: string[]; data?: unknown }) => {
        if (command === 'graphql_cache_enqueue_optimistic_mutation') {
          drafts.push(args?.data);
          return {
            transactionId: 'draft-1',
            changed: [],
            affectedOps: [],
            reset: false,
            upsertKind: { kind: 'inserted' },
            initialClaim: { kind: 'not-runnable' },
          };
        }
        if (command === 'graphql_cache_current_revision') return '0';
        if (command === 'graphql_cache_write') {
          started();
          await gate;
          stored.add('GraphqlSoupCrmContact:old-contact');
        }
        if (command === 'graphql_cache_delete_records') {
          for (const key of args?.keys ?? []) stored.delete(key);
        }
        if (command === 'graphql_cache_clear') {
          stored.clear();
          drafts.length = 0;
          return '0';
        }
        return {
          revision: '0',
          revisionAdvanced: false,
          changed: [],
          affectedOps: [],
          reset: false,
        };
      }
    );
    await host.enqueueOptimisticMutation(
      {
        uuid: 'draft-1',
        query: 'mutation { saveDraft }',
        data: { text: 'Unsent draft' },
      },
      { owner: 'runner', nowMs: 1, leaseExpiresAtMs: 2 }
    );
    const refetch = vi
      .spyOn(client.current, 'invalidateQueries')
      .mockImplementation(async () => {
        // Initial identity binding does not itself clear identity-less records.
        expect(stored.size).toBe(0);
        expect(drafts).toEqual([{ text: 'Unsent draft' }]);
        client.current?.setQueryData(authKeys.userInfo.queryKey, {
          userId: viewer,
          authenticated: true,
        });
      });
    const writer = prepareCrmContactEdit();
    const writing = writer.commit(
      {
        id: 'old-contact',
        companyId: null,
        email: null,
        name: 'Example person',
        hidden: false,
        createdAt: '2026-10-01',
        updatedAt: '2026-10-01',
        firstInteraction: '2026-10-01',
        lastInteraction: '2026-10-01',
      },
      null
    );
    await admitted;
    const replacing = invalidateAllAfterLogin();
    try {
      expect(writer.isCurrent()).toBe(false);
      expect(refetch).not.toHaveBeenCalled();
      release();
      await Promise.all([writing, replacing]);
      expect(refetch).toHaveBeenCalledOnce();
      expect(stored.size).toBe(0);
      expect(drafts).toEqual([{ text: 'Unsent draft' }]);
      expect(
        soup.invoke.mock.calls.some(
          ([command]) => command === 'graphql_cache_clear'
        )
      ).toBe(false);
      expect(prepareCrmContactEdit().isCurrent()).toBe(true);
    } finally {
      release();
      unregister();
      host.dispose();
      soup.host = undefined;
    }
  }
);

it('keeps replacement admission and refetch closed when contact repair fails', async () => {
  client.current = new QueryClient();
  await beginCacheWriteSession(async () => {}).ready;
  const host = {
    ...createNoopCacheHost(),
    disabled: false,
    deleteRecords: async () => {
      throw new Error('Contact cache repair failed');
    },
  };
  soup.host = host;
  const unregister = registerCacheHost(host);
  recordSessionCacheWrite(host, 'GraphqlSoupCrmContact:old-contact');
  const old = prepareCrmContactEdit();
  const refetch = vi.spyOn(client.current, 'invalidateQueries');
  try {
    await expect(invalidateAllAfterLogin()).rejects.toThrow(
      'Contact cache repair failed'
    );
    expect(old.isCurrent()).toBe(false);
    expect(prepareCrmContactEdit().isCurrent()).toBe(false);
    expect(refetch).not.toHaveBeenCalled();
    expect(toast.failure).toHaveBeenCalledWith(
      'Sign-in could not finish',
      expect.objectContaining({
        subtext: expect.stringContaining('queued changes are preserved'),
      })
    );
  } finally {
    await clearRegisteredCaches();
    unregister();
    soup.host = undefined;
  }
});

it('retries failed readiness on the retained owner before refetching a new identity', async () => {
  client.current = new QueryClient();
  await beginCacheWriteSession(async () => {}).ready;
  const stored = new Set(['GraphqlSoupCrmContact:old-contact', 'queued-draft']);
  const inner = {
    ...createNoopCacheHost(),
    disabled: false,
    deleteRecords: vi
      .fn(async (keys: string[]) => {
        for (const key of keys) stored.delete(key);
        return createNoopCacheHost().deleteRecords(keys);
      })
      .mockRejectedValueOnce(new Error('Storage temporarily unavailable')),
    clear: vi.fn(),
    dispose: vi.fn(),
  };
  const host = createRetirableCacheHost(inner);
  recordSessionCacheWrite(host, 'GraphqlSoupCrmContact:old-contact');
  soup.host = host;
  host.dispose();
  const refetch = vi
    .spyOn(client.current, 'invalidateQueries')
    .mockImplementation(async () => {
      expect(stored).toEqual(new Set(['queued-draft']));
    });
  try {
    await expect(invalidateAllAfterLogin()).rejects.toThrow(
      'Storage temporarily unavailable'
    );
    expect(refetch).not.toHaveBeenCalled();
    expect(captureCacheWriteSession().isCurrent()).toBe(false);
    expect(inner.dispose).not.toHaveBeenCalled();
    await invalidateAllAfterLogin();
    expect(refetch).toHaveBeenCalledOnce();
    expect(inner.clear).not.toHaveBeenCalled();
    expect(inner.dispose).toHaveBeenCalledOnce();
    expect(captureCacheWriteSession().isCurrent()).toBe(true);
  } finally {
    soup.host = undefined;
  }
});
