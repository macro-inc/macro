import type { CacheHost } from '@graphql-cache/index';
import { onlineManager, QueryClient } from '@tanstack/solid-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { channelReadNetworkMode } from '../flag';
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
