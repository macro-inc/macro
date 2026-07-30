import { describe, expect, it, vi } from 'vitest';

const toastFailure = vi.hoisted(() => vi.fn());
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: toastFailure },
}));

import {
  buildGraphqlSoupWebSocketUrl,
  createGraphqlSoupWebSocketUrlResolver,
  createSoupUpdatesSubscriptionLifecycle,
  SOUP_GRAPHQL_WEBSOCKET_RETRY_ATTEMPTS,
  shouldRetryGraphqlSoupWebSocket,
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

describe('Soup updates subscription lifecycle', () => {
  it('keeps one subscription, cleans up replacements, and skips disabled hosts', () => {
    const firstUnsubscribe = vi.fn();
    const secondUnsubscribe = vi.fn();
    const firstClient = {
      subscription: vi.fn(() => ({
        subscribe: vi.fn(() => ({ unsubscribe: firstUnsubscribe })),
      })),
    };
    const secondClient = {
      subscription: vi.fn(() => ({
        subscribe: vi.fn(() => ({ unsubscribe: secondUnsubscribe })),
      })),
    };
    const lifecycle = createSoupUpdatesSubscriptionLifecycle();

    lifecycle.replace(firstClient as never, { disabled: false } as never);
    expect(firstClient.subscription).toHaveBeenCalledOnce();

    lifecycle.replace(secondClient as never, { disabled: false } as never);
    expect(firstUnsubscribe).toHaveBeenCalledOnce();
    expect(secondClient.subscription).toHaveBeenCalledOnce();

    lifecycle.replace(firstClient as never, { disabled: true } as never);
    expect(secondUnsubscribe).toHaveBeenCalledOnce();
    expect(firstClient.subscription).toHaveBeenCalledOnce();

    lifecycle.dispose();
    expect(secondUnsubscribe).toHaveBeenCalledOnce();
  });

  it('signals a terminal subscription failure once', () => {
    toastFailure.mockClear();
    let receive: ((result: { error?: unknown }) => void) | undefined;
    const client = {
      subscription: vi.fn(() => ({
        subscribe: vi.fn((next) => {
          receive = next;
          return { unsubscribe: vi.fn() };
        }),
      })),
    };
    const lifecycle = createSoupUpdatesSubscriptionLifecycle();
    lifecycle.replace(client as never, { disabled: false } as never);

    receive?.({ error: new Error('retry budget exhausted') });
    receive?.({ error: new Error('duplicate terminal result') });

    expect(toastFailure).toHaveBeenCalledOnce();
    expect(toastFailure).toHaveBeenCalledWith('Live updates disconnected', {
      subtext: 'Refresh the app to reconnect.',
    });
    lifecycle.dispose();
  });
});
