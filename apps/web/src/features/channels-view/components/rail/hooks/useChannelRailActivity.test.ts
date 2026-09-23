import type { ChannelEntity } from '@entity/types/entity';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

const source = vi.hoisted(() => ({
  notifications: vi.fn(() => []),
  subscribe: vi.fn(() => () => {}),
}));
vi.mock('@components/app/GlobalAppState', () => ({
  useGlobalNotificationSource: () => source,
}));
vi.mock('@entity/utils/notification', () => ({
  notificationIsRead: (n: { state: string }) => n.state !== 'unseen',
}));

import { useChannelRailActivity } from './useChannelRailActivity';

const row = (
  id: string,
  unreadNotifications: ChannelEntity['unreadNotifications']
): ChannelEntity => ({
  id,
  type: 'channel',
  name: id,
  ownerId: 'owner',
  channelType: 'private',
  unreadNotifications,
});
const calls = {
  callActivity: () => [],
  callStatuses: () => new Map(),
  incomingCallIds: () => new Map(),
};
let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  vi.clearAllMocks();
});

describe('bounded channel unread indicators', () => {
  it('uses one witness per channel without reading the global notification feed', () => {
    const [channels, setChannels] = createSignal([
      row('one', [{ id: 'n1', state: 'unseen', createdAt: '2026-01-01' }]),
      row('two', []),
    ]);
    const activity = createRoot((cleanup) => {
      dispose = cleanup;
      return useChannelRailActivity(channels, calls);
    });
    expect([...activity.unreadChannelIds()]).toEqual(['one']);
    expect(activity.unreadCount('channels')).toBe(1);
    expect(activity.targetChannelId('channels')).toBe('one');
    expect(source.notifications).not.toHaveBeenCalled();
    // A mark-read can update the linked record before the bounded edge refresh.
    setChannels([
      row('one', [{ id: 'n1', state: 'seen', createdAt: '2026-01-01' }]),
      row('two', []),
    ]);
    expect(activity.unreadCount('channels')).toBe(0);
    // The refreshed edge finds another unread notification; then clears finally.
    setChannels([
      row('one', [{ id: 'older', state: 'unseen', createdAt: '2025-12-01' }]),
      row('two', []),
    ]);
    expect(activity.unreadCount('channels')).toBe(1);
    setChannels([row('one', []), row('two', [])]);
    expect(activity.unreadCount('channels')).toBe(0);
    expect(source.notifications).not.toHaveBeenCalled();
  });
});
