import { afterEach, describe, expect, it, vi } from 'vitest';

const coordinator = vi.hoisted(() => ({
  invalidateQuery: vi.fn(() => true),
  refresh: vi.fn(),
}));
vi.mock('./notification-refresh', () => ({
  channelNotificationRefresh: () => coordinator,
}));
const soupClient = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => soupClient,
}));
vi.mock('../client', () => ({
  queryClient: { invalidateQueries: vi.fn(async () => undefined) },
}));
vi.mock('@service-storage/client', () => ({ storageServiceClient: {} }));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: vi.fn() },
}));

import { refreshChannelParticipants } from './participants';

const CHANNEL_ID = '01a1fa85-798c-7956-80d4-1f36b50bd73b';

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  coordinator.invalidateQuery.mockReturnValue(true);
});

describe('refreshChannelParticipants', () => {
  it('waits for the mounted readers to read the channel again', async () => {
    let answer!: () => void;
    coordinator.refresh.mockReturnValue(
      new Promise<void>((resolve) => {
        answer = resolve;
      })
    );
    let done = false;
    const refreshed = refreshChannelParticipants(CHANNEL_ID).then(() => {
      done = true;
    });
    await vi.waitFor(() => expect(coordinator.refresh).toHaveBeenCalled());
    await Promise.resolve();
    expect(done).toBe(false);

    answer();
    await refreshed;
    expect(done).toBe(true);
    expect(soupClient.query).not.toHaveBeenCalled();
  });

  it('stops waiting for readers that do not read again within three seconds', async () => {
    vi.useFakeTimers();
    // The wait starts with the refresh, after the soup client's import.
    let startedAt = 0;
    coordinator.refresh.mockImplementation(() => {
      startedAt = Date.now();
      return new Promise<void>(() => undefined);
    });
    let done = false;
    const refreshed = refreshChannelParticipants(CHANNEL_ID).then(() => {
      done = true;
    });
    await vi.waitFor(() => expect(coordinator.refresh).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(startedAt + 2_900 - Date.now());
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    await refreshed;
    expect(done).toBe(true);
  });

  it('never fails the write when the readers fail to read again', async () => {
    coordinator.refresh.mockRejectedValue(new Error('unavailable'));
    await expect(
      refreshChannelParticipants(CHANNEL_ID)
    ).resolves.toBeUndefined();
  });

  it('reads the channel directly when no reader has it open', async () => {
    coordinator.invalidateQuery.mockReturnValue(false);
    soupClient.query.mockReturnValue({
      toPromise: async () => ({ data: {} }),
    });
    await refreshChannelParticipants(CHANNEL_ID);
    expect(soupClient.query).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { requestPolicy: 'network-only' }
    );
    expect(coordinator.refresh).not.toHaveBeenCalled();
  });
});
