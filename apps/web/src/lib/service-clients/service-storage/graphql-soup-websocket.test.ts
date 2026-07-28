import { describe, expect, it, vi } from 'vitest';
import {
  buildGraphqlSoupWebSocketUrl,
  createGraphqlSoupWebSocketUrlResolver,
  createSoupUpdatesSubscriptionLifecycle,
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
});
