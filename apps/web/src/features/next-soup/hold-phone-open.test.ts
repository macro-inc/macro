import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const prefetchInfiniteQuery = vi.hoisted(() => vi.fn());

vi.mock('@queries/client', () => ({
  queryClient: { prefetchInfiniteQuery },
}));
vi.mock('@queries/messages/timeline', () => ({
  messageTimelineQueryOptions: (parent: unknown, messageId: unknown) => ({
    parent,
    messageId,
  }),
}));
vi.mock('@channel/queries/prefetch-channel-target', () => ({
  prefetchChannelTarget: vi.fn(async () => {}),
}));
vi.mock('@core/constant/allBlocks', () => ({ blocks: {} }));

import {
  holdPhoneOpenUntilReady,
  PHONE_OPEN_HOLD_MAX_MS,
} from './hold-phone-open';

const channel = { type: 'channel', id: 'channel-1' };

describe('holdPhoneOpenUntilReady', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    prefetchInfiniteQuery.mockReset();
  });

  it('opens as soon as the latest messages arrive', async () => {
    prefetchInfiniteQuery.mockResolvedValueOnce(undefined);
    await expect(
      holdPhoneOpenUntilReady(channel, { kind: 'latest' })
    ).resolves.toBe(true);
    expect(prefetchInfiniteQuery).toHaveBeenCalledWith({
      parent: { type: 'channel', id: 'channel-1' },
      messageId: null,
    });
  });

  it('stops holding after the cap when messages are slow', async () => {
    prefetchInfiniteQuery.mockReturnValueOnce(new Promise(() => {}));
    let settled = false;
    const hold = (async () => {
      const result = await holdPhoneOpenUntilReady(channel, {
        kind: 'latest',
      });
      settled = true;
      return result;
    })();
    await vi.advanceTimersByTimeAsync(PHONE_OPEN_HOLD_MAX_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(hold).resolves.toBe(true);
  });

  it('cancels an earlier tap when another row is tapped during the hold', async () => {
    prefetchInfiniteQuery.mockReturnValue(new Promise(() => {}));
    const first = holdPhoneOpenUntilReady(channel, { kind: 'latest' });
    const second = holdPhoneOpenUntilReady(
      { type: 'channel', id: 'channel-2' },
      { kind: 'latest' }
    );
    await vi.advanceTimersByTimeAsync(PHONE_OPEN_HOLD_MAX_MS);
    await expect(first).resolves.toBe(false);
    await expect(second).resolves.toBe(true);
  });
});
