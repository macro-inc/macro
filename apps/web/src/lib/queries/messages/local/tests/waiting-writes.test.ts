import { afterEach, expect, it, vi } from 'vitest';
import {
  announceWaitingWrite,
  resetWaitingWrites,
  watchWaitingWrites,
} from '../waiting-writes';
import { CHANNEL_ID } from './fixtures';

const { refreshChannelViews, channelCacheHost } = vi.hoisted(() => ({
  refreshChannelViews: vi.fn(),
  channelCacheHost: vi.fn((): object | undefined => ({})),
}));
vi.mock('../catch-up', () => ({ refreshChannelViews }));
vi.mock('../flag', () => ({ channelCacheHost }));

afterEach(() => {
  resetWaitingWrites();
  refreshChannelViews.mockClear();
  channelCacheHost.mockReturnValue({});
});

/** What another window's announcement looks like to this one. */
function announceFromAnotherWindow(channelId: string) {
  window.dispatchEvent(
    new StorageEvent('storage', {
      key: 'macro.channel-write-waiting',
      newValue: JSON.stringify({
        type: 'channel-write-waiting',
        channelId,
        windowId: 'another-window',
        sentAt: 1,
      }),
    })
  );
}

it("reads a channel again when another window's write to it waits", () => {
  watchWaitingWrites();

  announceFromAnotherWindow(CHANNEL_ID);

  expect(refreshChannelViews).toHaveBeenCalledExactlyOnceWith(CHANNEL_ID);
});

it('does not read again for a write this window made', () => {
  watchWaitingWrites();

  announceWaitingWrite(CHANNEL_ID);

  expect(refreshChannelViews).not.toHaveBeenCalled();
});

it('does nothing while channels read from REST', () => {
  watchWaitingWrites();
  channelCacheHost.mockReturnValue(undefined);

  announceFromAnotherWindow(CHANNEL_ID);

  expect(refreshChannelViews).not.toHaveBeenCalled();
});
