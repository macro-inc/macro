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
  claimPhoneOpenTap,
  holdPhoneOpenUntilReady,
  PHONE_OPEN_HOLD_MAX_MS,
} from './hold-phone-open';

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
      holdPhoneOpenUntilReady({
        content: { type: 'channel', id: 'channel-1' },
        channelTarget: { kind: 'latest' },
        tap: claimPhoneOpenTap(),
        isSourceUnchanged: () => true,
      })
    ).resolves.toBe(true);
    expect(prefetchInfiniteQuery).toHaveBeenCalledWith({
      parent: { type: 'channel', id: 'channel-1' },
      messageId: null,
    });
  });

  it('stops holding after the cap when messages are slow', async () => {
    prefetchInfiniteQuery.mockReturnValueOnce(new Promise(() => {}));
    let settled = false;
    const slow = (async () => {
      const result = await holdPhoneOpenUntilReady({
        content: { type: 'channel', id: 'channel-1' },
        channelTarget: { kind: 'latest' },
        tap: claimPhoneOpenTap(),
        isSourceUnchanged: () => true,
      });
      settled = true;
      return result;
    })();
    await vi.advanceTimersByTimeAsync(PHONE_OPEN_HOLD_MAX_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(slow).resolves.toBe(true);
  });

  it('cancels an earlier tap when another row is tapped during the hold', async () => {
    prefetchInfiniteQuery.mockReturnValue(new Promise(() => {}));
    const first = holdPhoneOpenUntilReady({
      content: { type: 'channel', id: 'channel-1' },
      channelTarget: { kind: 'latest' },
      tap: claimPhoneOpenTap(),
      isSourceUnchanged: () => true,
    });
    const second = holdPhoneOpenUntilReady({
      content: { type: 'channel', id: 'channel-2' },
      channelTarget: { kind: 'latest' },
      tap: claimPhoneOpenTap(),
      isSourceUnchanged: () => true,
    });
    await vi.advanceTimersByTimeAsync(PHONE_OPEN_HOLD_MAX_MS);
    await expect(first).resolves.toBe(false);
    await expect(second).resolves.toBe(true);
  });

  it('cancels a held tap once a newer tap is claimed, before that tap holds', async () => {
    prefetchInfiniteQuery.mockResolvedValue(undefined);
    const firstTap = claimPhoneOpenTap();
    // The newer tap is still awaiting its notifications and has not held yet.
    claimPhoneOpenTap();
    await expect(
      holdPhoneOpenUntilReady({
        content: { type: 'channel', id: 'channel-1' },
        channelTarget: { kind: 'latest' },
        tap: firstTap,
        isSourceUnchanged: () => true,
      })
    ).resolves.toBe(false);
  });

  it('cancels the open when the source pane changed during the hold', async () => {
    prefetchInfiniteQuery.mockResolvedValueOnce(undefined);
    await expect(
      holdPhoneOpenUntilReady({
        content: { type: 'channel', id: 'channel-1' },
        channelTarget: { kind: 'latest' },
        tap: claimPhoneOpenTap(),
        isSourceUnchanged: () => false,
      })
    ).resolves.toBe(false);
  });
});
