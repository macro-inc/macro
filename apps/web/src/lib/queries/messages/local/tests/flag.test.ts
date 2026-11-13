import type { CacheHost } from '@graphql-cache/index';
import { onlineManager, QueryClient } from '@tanstack/solid-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { channelReadNetworkMode, retryOnceOnline } from '../flag';
import { fakeHost } from './fixtures';

vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupCacheHost: vi.fn(),
  graphqlCacheEnabled: vi.fn(),
}));

const host = fakeHost([]) as unknown as CacheHost;
const channel = { type: 'channel' };

describe('channelReadNetworkMode', () => {
  afterEach(() => onlineManager.setOnline(true));

  it('runs channel reads offline only when a cache host serves them', () => {
    expect(channelReadNetworkMode(channel, host)).toBe('offlineFirst');
    expect(channelReadNetworkMode(channel, undefined)).toBe('online');
    expect(channelReadNetworkMode({ type: 'document' }, host)).toBe('online');
  });

  it('a read in that mode reaches the device while the browser is offline', async () => {
    onlineManager.setOnline(false);
    const client = new QueryClient();
    const device = vi.fn(async () => 'held page');

    const paused = client.fetchQuery({
      queryKey: ['rest'],
      queryFn: device,
      networkMode: channelReadNetworkMode(channel, undefined),
    });
    await Promise.resolve();
    expect(device).not.toHaveBeenCalled();
    await client.cancelQueries({ queryKey: ['rest'] });
    await expect(paused).rejects.toBeDefined();

    await expect(
      client.fetchQuery({
        queryKey: ['device'],
        queryFn: device,
        networkMode: channelReadNetworkMode(channel, host),
      })
    ).resolves.toBe('held page');
  });
});

describe('retryOnceOnline', () => {
  afterEach(() => onlineManager.setOnline(true));

  const once = (failureCount: number, error: Error) =>
    error.message !== 'terminal' && failureCount < 1;
  const failed = new Error('failed');

  it('keeps the policy unchanged while online', () => {
    const retry = retryOnceOnline(once);
    expect(retry(0, failed)).toBe(true);
    expect(retry(1, failed)).toBe(false);
  });

  it('does not spend the retry on a failure while offline', () => {
    const retry = retryOnceOnline(once);
    onlineManager.setOnline(false);
    expect(retry(0, failed)).toBe(true);
    expect(retry(1, failed)).toBe(true);
    onlineManager.setOnline(true);
    expect(retry(2, failed)).toBe(true);
    expect(retry(3, failed)).toBe(false);
    // The next fetch starts with the plain policy again.
    expect(retry(0, failed)).toBe(true);
    expect(retry(1, failed)).toBe(false);
  });

  it('still ends on an error the policy never retries', () => {
    const retry = retryOnceOnline(once);
    onlineManager.setOnline(false);
    expect(retry(0, new Error('terminal'))).toBe(false);
  });

  it('pauses an offline read the device cannot serve until the connection returns', async () => {
    onlineManager.setOnline(false);
    const client = new QueryClient();
    // Mounting is what resumes paused reads when the connection returns.
    client.mount();
    const read = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(failed)
      .mockRejectedValueOnce(failed)
      .mockResolvedValue('server page');
    const result = client.fetchQuery({
      queryKey: ['unheld'],
      queryFn: read,
      networkMode: 'offlineFirst',
      retry: retryOnceOnline(once),
      retryDelay: 0,
    });
    await vi.waitFor(() =>
      expect(client.getQueryState(['unheld'])?.fetchStatus).toBe('paused')
    );
    expect(read).toHaveBeenCalledTimes(1);
    onlineManager.setOnline(true);
    await expect(result).resolves.toBe('server page');
    expect(read).toHaveBeenCalledTimes(3);
  });
});
