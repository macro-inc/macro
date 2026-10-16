import { err, ok } from 'neverthrow';
import { afterEach, describe, expect, it, vi } from 'vitest';

const toastFailure = vi.hoisted(() => vi.fn());
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: toastFailure },
}));

const nativeStatus = vi.hoisted(() => ({
  listeners: new Set<(status: string) => void>(),
}));
vi.mock('@core/mobile/native-network-status', () => ({
  subscribeNativeNetworkStatus: (listener: (status: string) => void) => {
    nativeStatus.listeners.add(listener);
    listener('online');
    return () => nativeStatus.listeners.delete(listener);
  },
}));

function setNativeStatus(status: string) {
  for (const listener of [...nativeStatus.listeners]) listener(status);
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

afterEach(() => {
  vi.useRealTimers();
  setVisibility('visible');
});

import {
  ActivityUpdatesDocument,
  NotificationUpdatesDocument,
  SoupUpdatesDocument,
} from './graphql/generated/graphql';
import {
  buildGraphqlSoupWebSocketUrl,
  createGraphqlSoupSubscriptionsLifecycle,
  createGraphqlSoupWebSocketUrlResolver,
  GraphqlSoupWebSocketAuthUnavailableError,
  SOUP_GRAPHQL_WEBSOCKET_RETRY_ATTEMPTS,
  shouldRetryGraphqlSoupWebSocket,
  subscribeToGraphqlNotificationPatches,
  waitToRetryGraphqlSoupWebSocket,
} from './graphql-soup-websocket';

describe('GraphQL Soup websocket auth', () => {
  it('maps HTTP protocols and appends encoded bearer auth', () => {
    expect(
      buildGraphqlSoupWebSocketUrl('https://gateway.macro.com/dss', 'token+/=')
    ).toBe(
      'wss://gateway.macro.com/dss/items/soup/graphql/ws?macro-api-token=token%2B%2F%3D'
    );
    expect(buildGraphqlSoupWebSocketUrl('http://localhost:8086')).toBe(
      'ws://localhost:8086/items/soup/graphql/ws'
    );
  });

  it('refreshes cookie auth before resolving each connection URL', async () => {
    const refreshCookieAuth = vi.fn().mockResolvedValue(ok(undefined));
    const getApiToken = vi.fn();
    const resolveUrl = createGraphqlSoupWebSocketUrlResolver({
      dssHost: 'https://gateway.macro.com/dss',
      bearerTokenAuth: false,
      getApiToken,
      refreshCookieAuth,
    });

    await expect(resolveUrl()).resolves.toBe(
      'wss://gateway.macro.com/dss/items/soup/graphql/ws'
    );
    expect(refreshCookieAuth).toHaveBeenCalledOnce();
    expect(getApiToken).not.toHaveBeenCalled();
  });

  it('refreshes bearer auth in the URL on every connection attempt', async () => {
    const getApiToken = vi
      .fn()
      .mockResolvedValueOnce('first')
      .mockResolvedValueOnce('second');
    const refreshCookieAuth = vi.fn();
    const resolveUrl = createGraphqlSoupWebSocketUrlResolver({
      dssHost: 'https://gateway.macro.com/dss',
      bearerTokenAuth: true,
      getApiToken,
      refreshCookieAuth,
    });

    await expect(resolveUrl()).resolves.toContain('macro-api-token=first');
    await expect(resolveUrl()).resolves.toContain('macro-api-token=second');
    expect(refreshCookieAuth).not.toHaveBeenCalled();
  });

  it('retries a cookie refresh lost to an outage but not a rejected session', async () => {
    const resolverFor = (code: string) =>
      createGraphqlSoupWebSocketUrlResolver({
        dssHost: 'https://gateway.macro.com/dss',
        bearerTokenAuth: false,
        getApiToken: vi.fn(),
        refreshCookieAuth: vi.fn().mockResolvedValue(err([{ code }])),
      });

    for (const code of ['NETWORK_ERROR', 'UNKNOWN_ERROR', 'HTTP_ERROR']) {
      const error = await resolverFor(code)().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(GraphqlSoupWebSocketAuthUnavailableError);
      expect(shouldRetryGraphqlSoupWebSocket(error)).toBe(true);
    }

    const rejected = await resolverFor('UNAUTHORIZED')().catch(
      (e: unknown) => e
    );
    expect(rejected).toBeInstanceOf(Error);
    expect(shouldRetryGraphqlSoupWebSocket(rejected)).toBe(false);
  });
});

describe('GraphQL Soup websocket retry policy', () => {
  it('keeps retrying transient failures but not auth or protocol failures', () => {
    expect(SOUP_GRAPHQL_WEBSOCKET_RETRY_ATTEMPTS).toBe(
      Number.POSITIVE_INFINITY
    );
    expect(shouldRetryGraphqlSoupWebSocket({ code: 1006 })).toBe(true);
    expect(shouldRetryGraphqlSoupWebSocket({ code: 1013 })).toBe(true);
    expect(shouldRetryGraphqlSoupWebSocket(new Event('error'))).toBe(true);
    expect(shouldRetryGraphqlSoupWebSocket({ code: 4401 })).toBe(false);
    expect(shouldRetryGraphqlSoupWebSocket({ code: 4403 })).toBe(false);
    expect(shouldRetryGraphqlSoupWebSocket({ code: 4406 })).toBe(false);
    expect(shouldRetryGraphqlSoupWebSocket(new Error('auth failed'))).toBe(
      false
    );
  });

  it('caps the wait between attempts', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const resolved = vi.fn();
    void waitToRetryGraphqlSoupWebSocket(30).then(resolved);

    await vi.advanceTimersByTimeAsync(62_999);
    expect(resolved).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(resolved).toHaveBeenCalledOnce();
    vi.mocked(Math.random).mockRestore();
  });

  it.each([
    ['the app returns to the foreground', () => setVisibility('visible')],
    ['the browser comes online', () => dispatchEvent(new Event('online'))],
    ['the native network path returns', () => setNativeStatus('online')],
  ])('stops waiting when %s', async (_name, opportunity) => {
    vi.useFakeTimers();
    setVisibility('hidden');
    setNativeStatus('offline');
    const resolved = vi.fn();
    void waitToRetryGraphqlSoupWebSocket(10).then(resolved);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(resolved).not.toHaveBeenCalled();

    opportunity();
    await vi.advanceTimersByTimeAsync(0);
    expect(resolved).toHaveBeenCalledOnce();
    expect(nativeStatus.listeners.size).toBe(0);
  });

  it('does not treat the current native status as a reconnect opportunity', async () => {
    vi.useFakeTimers();
    const resolved = vi.fn();
    void waitToRetryGraphqlSoupWebSocket(10).then(resolved);
    await vi.advanceTimersByTimeAsync(0);
    expect(resolved).not.toHaveBeenCalled();
  });
});

describe('GraphQL Soup subscription lifecycle', () => {
  it('keeps notification and activity updates active with or without a cache host', () => {
    const unsubscribes: Array<ReturnType<typeof vi.fn>> = [];
    const receive = new Map<unknown, (result: { data?: unknown }) => void>();
    const client = {
      query: vi.fn(),
      subscription: vi.fn((document) => ({
        subscribe: (next: (result: { data?: unknown }) => void) => {
          receive.set(document, next);
          const unsubscribe = vi.fn();
          unsubscribes.push(unsubscribe);
          return { unsubscribe };
        },
      })),
    };
    const lifecycle = createGraphqlSoupSubscriptionsLifecycle();
    const listener = vi.fn();
    const unregister = subscribeToGraphqlNotificationPatches(listener);
    for (const host of [
      { disabled: false, onCacheGenerationChanged: () => () => {} },
      { disabled: true },
      undefined,
    ]) {
      client.subscription.mockClear();
      lifecycle.replace(client as never, host as never);
      const documents = client.subscription.mock.calls.map(
        ([document]) => document
      );
      expect(documents).toContain(NotificationUpdatesDocument);
      expect(documents).toContain(ActivityUpdatesDocument);
      expect(documents.includes(SoupUpdatesDocument)).toBe(
        host?.disabled === false
      );
      const patch = {
        __typename: 'GraphqlNewNotification',
        notification: { id: 'one' },
      };
      receive.get(NotificationUpdatesDocument)?.({
        data: { notificationUpdates: patch },
      });
      expect(listener).toHaveBeenLastCalledWith(patch);
    }
    lifecycle.dispose();
    unregister();
    for (const unsubscribe of unsubscribes)
      expect(unsubscribe).toHaveBeenCalledOnce();
  });
  it('pauses subscriptions for navigation and reconnects in place exactly once per restore', () => {
    const unsubscribes: Array<ReturnType<typeof vi.fn>> = [];
    const client = {
      query: vi.fn(),
      subscription: vi.fn(() => ({
        subscribe: vi.fn(() => {
          const unsubscribe = vi.fn();
          unsubscribes.push(unsubscribe);
          return { unsubscribe };
        }),
      })),
    };
    const lifecycle = createGraphqlSoupSubscriptionsLifecycle({
      suspendOnPagehide: true,
    });
    lifecycle.replace(
      client as never,
      {
        disabled: false,
        onCacheGenerationChanged: () => () => {},
      } as never
    );
    expect(client.subscription).toHaveBeenCalledTimes(3);
    for (let cycle = 0; cycle < 2; cycle += 1) {
      dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
      for (const unsubscribe of unsubscribes)
        expect(unsubscribe).toHaveBeenCalledOnce();
      dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false }));
      expect(client.subscription).toHaveBeenCalledTimes((cycle + 1) * 3);
      dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      expect(client.subscription).toHaveBeenCalledTimes((cycle + 2) * 3);
    }
    dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    lifecycle.dispose();
    dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    expect(client.subscription).toHaveBeenCalledTimes(9);
    for (const unsubscribe of unsubscribes)
      expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('does not attach browser lifecycle behavior to the native client', () => {
    const unsubscribe = vi.fn();
    const client = {
      subscription: vi.fn(() => ({ subscribe: () => ({ unsubscribe }) })),
    };
    const lifecycle = createGraphqlSoupSubscriptionsLifecycle({
      suspendOnPagehide: false,
    });
    lifecycle.replace(client as never);
    dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    expect(client.subscription).toHaveBeenCalledTimes(2);
    expect(unsubscribe).not.toHaveBeenCalled();
    lifecycle.dispose();
  });

  it('signals a terminal subscription failure once across both subscriptions', () => {
    toastFailure.mockClear();
    const receive: Array<(result: { error?: unknown }) => void> = [];
    const client = {
      subscription: vi.fn(() => ({
        subscribe: vi.fn((next) => {
          receive.push(next);
          return { unsubscribe: vi.fn() };
        }),
      })),
    };
    const lifecycle = createGraphqlSoupSubscriptionsLifecycle();
    lifecycle.replace(
      client as never,
      {
        disabled: false,
        onCacheGenerationChanged: () => () => {},
      } as never
    );

    receive[0]?.({ error: new Error('retry budget exhausted') });
    receive[1]?.({ error: new Error('duplicate terminal result') });

    expect(toastFailure).toHaveBeenCalledOnce();
    expect(toastFailure).toHaveBeenCalledWith('Live updates disconnected', {
      subtext: 'Refresh to reconnect.',
    });
    lifecycle.dispose();
  });

  it('reattaches an ended subscription set on the next foreground or online signal', () => {
    toastFailure.mockClear();
    const receive: Array<
      (result: { error?: unknown; hasNext?: boolean }) => void
    > = [];
    const unsubscribes: Array<ReturnType<typeof vi.fn>> = [];
    const client = {
      subscription: vi.fn(() => ({
        subscribe: vi.fn((next) => {
          receive.push(next);
          const unsubscribe = vi.fn();
          unsubscribes.push(unsubscribe);
          return { unsubscribe };
        }),
      })),
    };
    const lifecycle = createGraphqlSoupSubscriptionsLifecycle();
    lifecycle.replace(client as never);
    expect(client.subscription).toHaveBeenCalledTimes(2);

    // Results that keep the stream open never reattach it.
    receive[0]?.({ hasNext: true });
    setVisibility('visible');
    expect(client.subscription).toHaveBeenCalledTimes(2);

    // A terminal result waits for an opportunity rather than a timer.
    const failed = receive[0];
    failed?.({ error: new Error('session rejected'), hasNext: false });
    receive[1]?.({ error: new Error('session rejected'), hasNext: false });
    expect(client.subscription).toHaveBeenCalledTimes(2);

    setVisibility('visible');
    expect(client.subscription).toHaveBeenCalledTimes(4);
    for (const unsubscribe of unsubscribes.slice(0, 2))
      expect(unsubscribe).toHaveBeenCalledOnce();

    // Late results from the replaced set and repeated signals do not
    // duplicate the healthy replacement.
    failed?.({ error: new Error('stale'), hasNext: false });
    setVisibility('visible');
    dispatchEvent(new Event('online'));
    expect(client.subscription).toHaveBeenCalledTimes(4);
    expect(toastFailure).toHaveBeenCalledOnce();

    receive[2]?.({ error: new Error('again'), hasNext: false });
    lifecycle.dispose();
    dispatchEvent(new Event('online'));
    expect(client.subscription).toHaveBeenCalledTimes(4);
  });

  it('signals a new outage after a successful reconnection', () => {
    toastFailure.mockClear();
    const receive: Array<(result: { error?: unknown }) => void> = [];
    const client = {
      subscription: vi.fn(() => ({
        subscribe: vi.fn((next) => {
          receive.push(next);
          return { unsubscribe: vi.fn() };
        }),
      })),
    };
    const lifecycle = createGraphqlSoupSubscriptionsLifecycle();
    lifecycle.replace(client as never);

    receive[0]?.({ error: new Error('first outage') });
    lifecycle.connected();
    receive[0]?.({ error: new Error('second outage') });

    expect(toastFailure).toHaveBeenCalledTimes(2);
    lifecycle.dispose();
  });
});
