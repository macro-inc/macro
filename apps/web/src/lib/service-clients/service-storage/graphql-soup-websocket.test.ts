import { describe, expect, it, vi } from 'vitest';

const toastFailure = vi.hoisted(() => vi.fn());
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: toastFailure },
}));

import {
  NotificationUpdatesDocument,
  SoupUpdatesDocument,
} from './graphql/generated/graphql';
import {
  buildGraphqlSoupWebSocketUrl,
  createGraphqlSoupSubscriptionsLifecycle,
  createGraphqlSoupWebSocketUrlResolver,
  SOUP_GRAPHQL_WEBSOCKET_RETRY_ATTEMPTS,
  shouldRetryGraphqlSoupWebSocket,
  subscribeToGraphqlNotificationPatches,
} from './graphql-soup-websocket';

describe('GraphQL Soup websocket auth', () => {
  it('maps HTTP protocols and appends encoded bearer auth', () => {
    expect(
      buildGraphqlSoupWebSocketUrl(
        'https://cloud-storage.macro.com',
        'token+/='
      )
    ).toBe(
      'wss://cloud-storage.macro.com/items/soup/graphql/ws?macro-api-token=token%2B%2F%3D'
    );
    expect(buildGraphqlSoupWebSocketUrl('http://localhost:8086')).toBe(
      'ws://localhost:8086/items/soup/graphql/ws'
    );
  });

  it('refreshes cookie auth before resolving each connection URL', async () => {
    const refreshCookieAuth = vi.fn().mockResolvedValue(undefined);
    const getApiToken = vi.fn();
    const resolveUrl = createGraphqlSoupWebSocketUrlResolver({
      dssHost: 'https://cloud-storage.macro.com',
      bearerTokenAuth: false,
      getApiToken,
      refreshCookieAuth,
    });

    await expect(resolveUrl()).resolves.toBe(
      'wss://cloud-storage.macro.com/items/soup/graphql/ws'
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
      dssHost: 'https://cloud-storage.macro.com',
      bearerTokenAuth: true,
      getApiToken,
      refreshCookieAuth,
    });

    await expect(resolveUrl()).resolves.toContain('macro-api-token=first');
    await expect(resolveUrl()).resolves.toContain('macro-api-token=second');
    expect(refreshCookieAuth).not.toHaveBeenCalled();
  });
});

describe('GraphQL Soup websocket retry policy', () => {
  it('bounds retries and accepts only transient failures', () => {
    expect(SOUP_GRAPHQL_WEBSOCKET_RETRY_ATTEMPTS).toBe(5);
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
});

describe('GraphQL Soup subscription lifecycle', () => {
  it('keeps notification patches active without a cache host and cleans up replacements', () => {
    const firstSoupUnsubscribe = vi.fn();
    const firstNotificationUnsubscribe = vi.fn();
    const uncachedNotificationUnsubscribe = vi.fn();
    const secondSoupUnsubscribe = vi.fn();
    const secondNotificationUnsubscribe = vi.fn();
    const firstClient = {
      subscription: vi
        .fn()
        .mockReturnValueOnce({
          subscribe: vi.fn(() => ({ unsubscribe: firstSoupUnsubscribe })),
        })
        .mockReturnValueOnce({
          subscribe: vi.fn(() => ({
            unsubscribe: firstNotificationUnsubscribe,
          })),
        })
        .mockReturnValueOnce({
          subscribe: vi.fn(() => ({
            unsubscribe: uncachedNotificationUnsubscribe,
          })),
        }),
    };
    const secondClient = {
      subscription: vi
        .fn()
        .mockReturnValueOnce({
          subscribe: vi.fn(() => ({ unsubscribe: secondSoupUnsubscribe })),
        })
        .mockReturnValueOnce({
          subscribe: vi.fn(() => ({
            unsubscribe: secondNotificationUnsubscribe,
          })),
        }),
    };
    const lifecycle = createGraphqlSoupSubscriptionsLifecycle();

    lifecycle.replace(firstClient as never, { disabled: false } as never);
    expect(firstClient.subscription).toHaveBeenNthCalledWith(
      1,
      SoupUpdatesDocument,
      {}
    );
    expect(firstClient.subscription).toHaveBeenNthCalledWith(
      2,
      NotificationUpdatesDocument,
      {}
    );

    lifecycle.replace(secondClient as never, { disabled: false } as never);
    expect(firstSoupUnsubscribe).toHaveBeenCalledOnce();
    expect(firstNotificationUnsubscribe).toHaveBeenCalledOnce();
    expect(secondClient.subscription).toHaveBeenCalledTimes(2);

    lifecycle.replace(firstClient as never, { disabled: true } as never);
    expect(secondSoupUnsubscribe).toHaveBeenCalledOnce();
    expect(secondNotificationUnsubscribe).toHaveBeenCalledOnce();
    expect(firstClient.subscription).toHaveBeenCalledTimes(3);
    expect(firstClient.subscription).toHaveBeenNthCalledWith(
      3,
      NotificationUpdatesDocument,
      {}
    );

    lifecycle.dispose();
    expect(uncachedNotificationUnsubscribe).toHaveBeenCalledOnce();
  });

  it('publishes typed notification patches to frontend listeners', () => {
    const receive: Array<(result: { data?: unknown }) => void> = [];
    const client = {
      subscription: vi.fn(() => ({
        subscribe: vi.fn((next) => {
          receive.push(next);
          return { unsubscribe: vi.fn() };
        }),
      })),
    };
    const listener = vi.fn();
    const unsubscribe = subscribeToGraphqlNotificationPatches(listener);
    const lifecycle = createGraphqlSoupSubscriptionsLifecycle();
    lifecycle.replace(client as never, { disabled: false } as never);

    receive[0]?.({ data: { soupUpdates: [] } });
    expect(listener).not.toHaveBeenCalled();

    const patch = {
      __typename: 'GraphqlNewNotification',
      notification: { id: 'notification-id' },
    };
    receive[1]?.({ data: { notificationUpdates: patch } });
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(patch);

    unsubscribe();
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
    lifecycle.replace(client as never, { disabled: false } as never);

    receive[0]?.({ error: new Error('retry budget exhausted') });
    receive[1]?.({ error: new Error('duplicate terminal result') });

    expect(toastFailure).toHaveBeenCalledOnce();
    expect(toastFailure).toHaveBeenCalledWith('Live updates disconnected', {
      subtext: 'Refresh to reconnect.',
    });
    lifecycle.dispose();
  });
});
