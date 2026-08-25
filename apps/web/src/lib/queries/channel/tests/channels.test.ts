import type { ApiChannelWithLatest } from '@service-storage/channel-list-types';
import { storageServiceClient } from '@service-storage/client';
import { ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchAllChannels } from '../channels';

vi.mock('@service-storage/client', () => ({
  storageServiceClient: {
    getChannels: vi.fn(),
  },
}));

describe('fetchAllChannels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches every channel page and returns one complete list', async () => {
    const firstChannel = { id: 'channel-1' } as ApiChannelWithLatest;
    const secondChannel = { id: 'channel-2' } as ApiChannelWithLatest;
    vi.mocked(storageServiceClient.getChannels)
      .mockResolvedValueOnce(
        ok({
          items: [firstChannel],
          next_cursor: 'next-page',
        })
      )
      .mockResolvedValueOnce(
        ok({
          items: [secondChannel],
          next_cursor: null,
        })
      );
    const controller = new AbortController();

    await expect(fetchAllChannels(controller.signal)).resolves.toEqual([
      firstChannel,
      secondChannel,
    ]);
    expect(storageServiceClient.getChannels).toHaveBeenNthCalledWith(1, {
      cursor: undefined,
      limit: 100,
      signal: controller.signal,
    });
    expect(storageServiceClient.getChannels).toHaveBeenNthCalledWith(2, {
      cursor: 'next-page',
      limit: 100,
      signal: controller.signal,
    });
  });
});
