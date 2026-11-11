import { toast } from '@core/component/Toast/Toast';
import { storageServiceClient } from '@service-storage/client';
import { QueryClient } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let testQueryClient: QueryClient;

vi.mock('../../client', () => ({
  get queryClient() {
    return testQueryClient;
  },
}));

vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: vi.fn(), success: vi.fn() },
}));

vi.mock('@service-storage/client', () => ({
  storageServiceClient: {
    getChannelJoinLink: vi.fn(),
    joinChannelByCode: vi.fn(),
  },
}));

import {
  getChannelJoinLinkMutationOptions,
  joinChannelByCodeMutationOptions,
} from '../join-links';
import { channelKeys } from '../keys';

const mutationContext = () => ({
  client: testQueryClient,
  meta: undefined,
  mutationKey: undefined,
});

describe('channel join-link mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testQueryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
  });

  it('does not request a join code until the lazy mutation executes', async () => {
    vi.mocked(storageServiceClient.getChannelJoinLink).mockResolvedValue(
      ok({ join_code: 'join-code' })
    );

    const options = getChannelJoinLinkMutationOptions();

    expect(storageServiceClient.getChannelJoinLink).not.toHaveBeenCalled();

    await expect(
      options.mutationFn({ channelId: 'channel-1' })
    ).resolves.toEqual({ join_code: 'join-code' });
    expect(storageServiceClient.getChannelJoinLink).toHaveBeenCalledWith({
      channel_id: 'channel-1',
    });
  });

  it('joins with the supplied code and invalidates the channel list', async () => {
    vi.mocked(storageServiceClient.joinChannelByCode).mockResolvedValue(
      ok(undefined)
    );
    const invalidateQueries = vi.spyOn(testQueryClient, 'invalidateQueries');
    const options = joinChannelByCodeMutationOptions();
    const args = { joinCode: 'join-code' };

    await expect(options.mutationFn(args)).resolves.toBeUndefined();
    expect(storageServiceClient.joinChannelByCode).toHaveBeenCalledWith({
      join_code: 'join-code',
    });

    await options.onSuccess?.(undefined, args, undefined, mutationContext());
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: channelKeys.listChannels.queryKey,
    });
  });

  it('throws and shows the standard failure toast when link generation fails', async () => {
    vi.mocked(storageServiceClient.getChannelJoinLink).mockResolvedValue(
      err([{ code: 'SERVER_ERROR', message: 'unavailable' }])
    );
    const options = getChannelJoinLinkMutationOptions();
    const args = { channelId: 'channel-1' };

    await expect(options.mutationFn(args)).rejects.toThrow();
    await options.onError?.(
      new Error('unavailable'),
      args,
      undefined,
      mutationContext()
    );

    expect(toast.failure).toHaveBeenCalledWith(
      'Failed to generate channel join link'
    );
  });

  it('throws and shows the standard failure toast when joining fails', async () => {
    vi.mocked(storageServiceClient.joinChannelByCode).mockResolvedValue(
      err([{ code: 'SERVER_ERROR', message: 'unavailable' }])
    );
    const options = joinChannelByCodeMutationOptions();
    const args = { joinCode: 'invalid-code' };

    await expect(options.mutationFn(args)).rejects.toThrow();
    await options.onError?.(
      new Error('unavailable'),
      args,
      undefined,
      mutationContext()
    );

    expect(toast.failure).toHaveBeenCalledWith('Failed to join channel');
  });
});
