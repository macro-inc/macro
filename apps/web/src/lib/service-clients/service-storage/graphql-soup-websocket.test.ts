import { err, ok } from 'neverthrow';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { make, type Source, subscribe } from 'wonka';

const telemetryError = vi.hoisted(() => vi.fn());
vi.mock('@macro-inc/observability', () => ({
  NOOP_SPAN: {},
  Telemetry: { error: telemetryError },
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

/** A subscription's results, as urql's client hands them out (a source with
 * a `subscribe` method): `start` gets each subscriber's callbacks and says
 * how to stop. */
function resultSource<T>(
  start: (
    next: (result: T) => void,
    end: () => void
  ) => { unsubscribe: () => void }
) {
  const source: Source<T> = make(
    (observer) => start(observer.next, observer.complete).unsubscribe
  );
  return Object.assign(source, {
    subscribe: (next: (result: T) => void) => subscribe(next)(source),
  });
}

afterEach(() => {
  vi.useRealTimers();
  setVisibility('visible');
});

import { registerActivityRevalidator } from '../../queries/activity/push-registry';
import { registerActiveGraphqlSoupQuery } from '../../queries/soup/graphql/active-queries';
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
  publishNotificationPatch,
  SOUP_GRAPHQL_WEBSOCKET_RETRY_ATTEMPTS,
  SUBSCRIBE_REGISTRATION_MS,
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
    const waiting = waitToRetryGraphqlSoupWebSocket(30).then(resolved);

    await vi.advanceTimersByTimeAsync(62_999);
    expect(resolved).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(resolved).toHaveBeenCalledOnce();
    await waiting;
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
    const waiting = waitToRetryGraphqlSoupWebSocket(10).then(resolved);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(resolved).not.toHaveBeenCalled();

    opportunity();
    await vi.advanceTimersByTimeAsync(0);
    expect(resolved).toHaveBeenCalledOnce();
    await waiting;
    expect(nativeStatus.listeners.size).toBe(0);
  });

  it('does not treat the current native status as a reconnect opportunity', async () => {
    vi.useFakeTimers();
    const resolved = vi.fn();
    const waiting = waitToRetryGraphqlSoupWebSocket(10).then(resolved);
    await vi.advanceTimersByTimeAsync(0);
    expect(resolved).not.toHaveBeenCalled();

    dispatchEvent(new Event('online'));
    await waiting;
  });
});

describe('GraphQL Soup subscription lifecycle', () => {
  it('marks listener failures on the receipt span and continues delivery', () => {
    const failure = new Error('notification listener failed');
    const stopFailed = subscribeToGraphqlNotificationPatches(() => {
      throw failure;
    });
    const received = vi.fn();
    const stopReceived = subscribeToGraphqlNotificationPatches(received);
    const span = { error: vi.fn() };
    const patch = {
      __typename: 'GraphqlCacheDeletion' as const,
      graphqlTypeName: 'GraphqlNotification',
      entityId: 'synthetic-notification',
    };
    try {
      publishNotificationPatch(patch, span);
      expect(span.error).toHaveBeenCalledExactlyOnceWith(failure);
      expect(telemetryError).toHaveBeenCalledWith(failure, {
        surface: 'graphql-notifications',
      });
      expect(received).toHaveBeenCalledExactlyOnceWith(patch);
    } finally {
      stopFailed();
      stopReceived();
    }
  });

  it('keeps notification and activity updates active with or without a cache host', () => {
    const unsubscribes: Array<ReturnType<typeof vi.fn>> = [];
    const receive = new Map<unknown, (result: { data?: unknown }) => void>();
    const client = {
      query: vi.fn(),
      subscription: vi.fn((document) =>
        resultSource((next: (result: { data?: unknown }) => void) => {
          receive.set(document, next);
          const unsubscribe = vi.fn();
          unsubscribes.push(unsubscribe);
          return { unsubscribe };
        })
      ),
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
      // Network receipt owns alerts; cache catch-up must never replay them.
      expect(listener).not.toHaveBeenCalled();
    }
    lifecycle.dispose();
    unregister();
    for (const unsubscribe of unsubscribes)
      expect(unsubscribe).toHaveBeenCalledOnce();
  });
  it('refetches mounted call lists when a Soup update carries a call', async () => {
    const receive = new Map<unknown, (result: { data?: unknown }) => void>();
    const client = {
      query: vi.fn(),
      subscription: vi.fn((document) =>
        resultSource((next: (result: { data?: unknown }) => void) => {
          receive.set(document, next);
          return { unsubscribe: vi.fn() };
        })
      ),
    };
    const refresh = vi.fn(async () => {});
    const unregister = registerActiveGraphqlSoupQuery({
      isEnabled: () => true,
      refresh,
      body: () => ({}),
    });
    const lifecycle = createGraphqlSoupSubscriptionsLifecycle();
    lifecycle.replace(
      client as never,
      { disabled: false, onCacheGenerationChanged: () => () => {} } as never
    );

    receive.get(SoupUpdatesDocument)?.({
      data: {
        soupUpdates: [
          {
            __typename: 'SoupUpdated',
            item: { __typename: 'GraphqlSoupCall', id: 'imported-call' },
          },
        ],
      },
    });
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());

    lifecycle.dispose();
    unregister();
  });

  it('refetches mounted attachment-filtered Mail lists after a reconnect, not on the first connection', async () => {
    const client = {
      query: vi.fn(),
      subscription: vi.fn(() => resultSource(() => ({ unsubscribe: vi.fn() }))),
    };
    const attachmentList = vi.fn(async () => {});
    const otherList = vi.fn(async () => {});
    const unregisterAttachments = registerActiveGraphqlSoupQuery({
      isEnabled: () => true,
      refresh: attachmentList,
      body: () => ({ ef: { l: { Attachment: 'pdf' } } }),
    });
    const unregisterOther = registerActiveGraphqlSoupQuery({
      isEnabled: () => true,
      refresh: otherList,
      body: () => ({ ef: { l: { Importance: true } } }),
    });
    const lifecycle = createGraphqlSoupSubscriptionsLifecycle();
    lifecycle.replace(
      client as never,
      { disabled: false, onCacheGenerationChanged: () => () => {} } as never
    );

    lifecycle.connected();
    await Promise.resolve();
    expect(attachmentList).not.toHaveBeenCalled();

    lifecycle.connected();
    await vi.waitFor(() => expect(attachmentList).toHaveBeenCalledOnce());
    expect(otherList).not.toHaveBeenCalled();

    lifecycle.dispose();
    unregisterAttachments();
    unregisterOther();
  });

  it('pauses subscriptions for navigation and reconnects in place exactly once per restore', () => {
    const unsubscribes: Array<ReturnType<typeof vi.fn>> = [];
    const client = {
      query: vi.fn(),
      subscription: vi.fn(() =>
        resultSource(
          vi.fn(() => {
            const unsubscribe = vi.fn();
            unsubscribes.push(unsubscribe);
            return { unsubscribe };
          })
        )
      ),
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
      subscription: vi.fn(() => resultSource(() => ({ unsubscribe }))),
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
    telemetryError.mockClear();
    const receive: Array<(result: { error?: unknown }) => void> = [];
    const client = {
      subscription: vi.fn(() =>
        resultSource(
          vi.fn((next) => {
            receive.push(next);
            return { unsubscribe: vi.fn() };
          })
        )
      ),
    };
    const lifecycle = createGraphqlSoupSubscriptionsLifecycle();
    lifecycle.replace(
      client as never,
      {
        disabled: false,
        onCacheGenerationChanged: () => () => {},
      } as never
    );

    const firstError = new Error('retry budget exhausted');
    receive[0]?.({ error: firstError });
    receive[1]?.({ error: new Error('duplicate terminal result') });

    expect(telemetryError).toHaveBeenCalledOnce();
    expect(telemetryError).toHaveBeenCalledWith(firstError, {
      'error.source': 'graphql-soup-websocket',
    });
    lifecycle.dispose();
  });

  it('reattaches an ended subscription set on the next foreground or online signal', () => {
    telemetryError.mockClear();
    const receive: Array<
      (result: { error?: unknown; hasNext?: boolean }) => void
    > = [];
    const unsubscribes: Array<ReturnType<typeof vi.fn>> = [];
    const client = {
      subscription: vi.fn(() =>
        resultSource(
          vi.fn((next) => {
            receive.push(next);
            const unsubscribe = vi.fn();
            unsubscribes.push(unsubscribe);
            return { unsubscribe };
          })
        )
      ),
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
    expect(telemetryError).toHaveBeenCalledOnce();

    receive[2]?.({ error: new Error('again'), hasNext: false });
    lifecycle.dispose();
    dispatchEvent(new Event('online'));
    expect(client.subscription).toHaveBeenCalledTimes(4);
  });

  it('says since when updates reached the cache host without a break', () => {
    vi.useFakeTimers();
    const receive: Array<
      (result: { error?: unknown; hasNext?: boolean }) => void
    > = [];
    const client = {
      query: vi.fn(),
      subscription: vi.fn(() =>
        resultSource(
          vi.fn((next) => {
            receive.push(next);
            return { unsubscribe: vi.fn() };
          })
        )
      ),
    };
    const host = {
      disabled: false,
      onCacheGenerationChanged: () => () => {},
    };
    const lifecycle = createGraphqlSoupSubscriptionsLifecycle({
      suspendOnPagehide: true,
    });
    try {
      vi.setSystemTime(1_000);
      lifecycle.replace(client as never, host as never);
      // Subscribed, but nothing reaches the server before the socket opens.
      expect(lifecycle.updatesLiveSince()).toBeUndefined();
      vi.setSystemTime(2_000);
      lifecycle.socketConnected();
      expect(lifecycle.updatesLiveSince()).toBe(
        2_000 + SUBSCRIBE_REGISTRATION_MS
      );

      vi.setSystemTime(3_000);
      lifecycle.socketClosed();
      expect(lifecycle.updatesLiveSince()).toBeUndefined();
      // A refresh after the socket closed does not make it live again.
      lifecycle.connected();
      expect(lifecycle.updatesLiveSince()).toBeUndefined();
      vi.setSystemTime(4_000);
      lifecycle.socketConnected();
      expect(lifecycle.updatesLiveSince()).toBe(
        4_000 + SUBSCRIBE_REGISTRATION_MS
      );

      // A subscription that ended or failed misses what follows.
      receive.at(-1)?.({ hasNext: true });
      expect(lifecycle.updatesLiveSince()).toBe(
        4_000 + SUBSCRIBE_REGISTRATION_MS
      );
      receive.at(-1)?.({ error: new Error('lagging'), hasNext: false });
      expect(lifecycle.updatesLiveSince()).toBeUndefined();
      // Attached again on the open socket.
      vi.setSystemTime(5_000);
      lifecycle.replace(client as never, host as never);
      expect(lifecycle.updatesLiveSince()).toBe(
        5_000 + SUBSCRIBE_REGISTRATION_MS
      );

      // Paused for navigation.
      dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
      expect(lifecycle.updatesLiveSince()).toBeUndefined();
      vi.setSystemTime(6_000);
      dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      expect(lifecycle.updatesLiveSince()).toBe(
        6_000 + SUBSCRIBE_REGISTRATION_MS
      );

      // A cache that takes no updates.
      host.disabled = true;
      expect(lifecycle.updatesLiveSince()).toBeUndefined();
      host.disabled = false;
      expect(lifecycle.updatesLiveSince()).toBe(
        6_000 + SUBSCRIBE_REGISTRATION_MS
      );
      // Subscriptions without the cache host write no cache.
      lifecycle.replace(client as never);
      lifecycle.connected();
      expect(lifecycle.updatesLiveSince()).toBeUndefined();

      lifecycle.replace(client as never, host as never);
      expect(lifecycle.updatesLiveSince()).toBe(
        6_000 + SUBSCRIBE_REGISTRATION_MS
      );
      lifecycle.dispose();
      expect(lifecycle.updatesLiveSince()).toBeUndefined();
    } finally {
      lifecycle.dispose();
      vi.useRealTimers();
    }
  });

  it('stops saying updates reach the cache once a subscription ends without a result, until it is attached again', () => {
    const ends: Array<() => void> = [];
    const client = {
      query: vi.fn(),
      subscription: vi.fn(() =>
        resultSource((_next, end) => {
          ends.push(end);
          return { unsubscribe: vi.fn() };
        })
      ),
    };
    const lifecycle = createGraphqlSoupSubscriptionsLifecycle();
    try {
      lifecycle.replace(
        client as never,
        {
          disabled: false,
          onCacheGenerationChanged: () => () => {},
        } as never
      );
      lifecycle.socketConnected();
      expect(lifecycle.updatesLiveSince()).toBeDefined();

      // The server dropped a subscriber that fell behind, before it ever
      // sent it a result.
      ends.at(-1)?.();
      expect(lifecycle.updatesLiveSince()).toBeUndefined();
      // The socket reconnecting does not attach the ended set again.
      lifecycle.socketClosed();
      lifecycle.socketConnected();
      expect(lifecycle.updatesLiveSince()).toBeUndefined();

      // The next foreground signal attaches a new set.
      setVisibility('visible');
      expect(client.subscription).toHaveBeenCalledTimes(6);
      expect(lifecycle.updatesLiveSince()).toBeDefined();
    } finally {
      lifecycle.dispose();
    }
  });

  it('stops saying updates reach the cache after a failed result, even while the socket reconnects', () => {
    const receive: Array<(result: { error?: unknown }) => void> = [];
    const client = {
      query: vi.fn(),
      subscription: vi.fn(() =>
        resultSource((next: (result: { error?: unknown }) => void) => {
          receive.push(next);
          return { unsubscribe: vi.fn() };
        })
      ),
    };
    const lifecycle = createGraphqlSoupSubscriptionsLifecycle();
    try {
      lifecycle.replace(
        client as never,
        {
          disabled: false,
          onCacheGenerationChanged: () => () => {},
        } as never
      );
      lifecycle.socketConnected();
      expect(lifecycle.updatesLiveSince()).toBeDefined();

      // urql gives no end after GraphQL errors: the subscription may be
      // gone, and what the failed result carried never reached the cache.
      receive.at(-1)?.({ error: new Error('subscription failed') });
      expect(lifecycle.updatesLiveSince()).toBeUndefined();
      lifecycle.connected();
      lifecycle.socketClosed();
      lifecycle.socketConnected();
      expect(lifecycle.updatesLiveSince()).toBeUndefined();

      // The next foreground signal attaches a new set.
      setVisibility('visible');
      expect(client.subscription).toHaveBeenCalledTimes(6);
      expect(lifecycle.updatesLiveSince()).toBeDefined();

      // An update the cache failed to take is missed as well.
      receive.at(-1)?.({
        extensions: {
          __macroNormalizedCache: {
            source: 'live-network',
            cacheEffectsApplied: false,
          },
        },
      } as { error?: unknown });
      expect(lifecycle.updatesLiveSince()).toBeUndefined();
    } finally {
      lifecycle.dispose();
    }
  });

  it('says nothing reaches the cache from a set attached without the cache host, once the host is enabled', () => {
    const client = {
      query: vi.fn(),
      subscription: vi.fn(() => resultSource(() => ({ unsubscribe: vi.fn() }))),
    };
    const host = { disabled: true, onCacheGenerationChanged: () => () => {} };
    const lifecycle = createGraphqlSoupSubscriptionsLifecycle();
    try {
      lifecycle.replace(client as never, host as never);
      lifecycle.socketConnected();
      // The set holds no SoupUpdates subscription.
      host.disabled = false;
      lifecycle.socketClosed();
      lifecycle.socketConnected();
      expect(lifecycle.updatesLiveSince()).toBeUndefined();
    } finally {
      lifecycle.dispose();
    }
  });

  it('refreshes activity when it subscribes the same client again', async () => {
    vi.useFakeTimers();
    const client = {
      subscription: vi.fn(() =>
        resultSource(vi.fn(() => ({ unsubscribe: vi.fn() })))
      ),
    };
    const refresh = vi.fn();
    const unregister = registerActivityRevalidator({
      client: () => client as never,
      refresh,
    });
    const lifecycle = createGraphqlSoupSubscriptionsLifecycle();
    lifecycle.replace(client as never);
    await vi.advanceTimersByTimeAsync(1_001);
    expect(refresh).not.toHaveBeenCalled();

    // A push between the two sets, or one whose refresh was not due yet.
    lifecycle.replace(client as never, { disabled: true } as never);
    await vi.advanceTimersByTimeAsync(1_001);
    expect(refresh).toHaveBeenCalledExactlyOnceWith(null);
    lifecycle.dispose();
    unregister();
  });

  it('signals a new outage after a successful reconnection', () => {
    telemetryError.mockClear();
    const receive: Array<(result: { error?: unknown }) => void> = [];
    const client = {
      subscription: vi.fn(() =>
        resultSource(
          vi.fn((next) => {
            receive.push(next);
            return { unsubscribe: vi.fn() };
          })
        )
      ),
    };
    const lifecycle = createGraphqlSoupSubscriptionsLifecycle();
    lifecycle.replace(client as never);

    receive[0]?.({ error: new Error('first outage') });
    lifecycle.connected();
    receive[0]?.({ error: new Error('second outage') });

    expect(telemetryError).toHaveBeenCalledTimes(2);
    lifecycle.dispose();
  });
});
