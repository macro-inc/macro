import type { ChannelEntity } from '@entity/types/entity';
import type { NotificationSource } from '@notifications/notification-source';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const source = vi.hoisted(() => ({
  notifications: vi.fn<NotificationSource['notifications']>(() => []),
  mutedEntities: () => [],
  subscribe: vi.fn(() => () => {}),
  withLocalState: vi.fn<NonNullable<NotificationSource['withLocalState']>>(),
}));
vi.mock('@components/app/GlobalAppState', () => ({
  useGlobalNotificationSource: () => source,
}));
const rail = vi.hoisted(() => ({
  railId: 'rail',
  selectedChannel: () => undefined,
  list: { focus: { key: () => undefined } },
  channelActivity: { unreadChannelIds: () => new Set<string>() },
}));
vi.mock('../ChannelsRailContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ChannelsRailContext')>()),
  useChannelsRail: () => rail,
}));

import { useChannelRailActivity } from './useChannelRailActivity';
import { useChannelRailFavoriteItemState } from './useChannelRailState';

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
beforeEach(() => {
  source.withLocalState.mockImplementation(
    (notification) => notification.state
  );
});
afterEach(() => {
  dispose?.();
  vi.clearAllMocks();
});

describe('bounded channel unread indicators', () => {
  it('ignores reply mentions while retaining older top-level mentions in legacy rows', () => {
    const mention = (id: string, threadId?: string) =>
      ({
        id,
        entity_type: 'channel',
        entity_id: id,
        state: 'unseen',
        created_at: '2026-01-01',
        notification_metadata: {
          tag: 'channel_mention',
          content: { messageId: 'message', threadId },
        },
      }) as ReturnType<NotificationSource['notifications']>[number];
    source.notifications.mockReturnValue([
      mention('reply', 'root'),
      mention('root'),
    ]);
    const activity = createRoot((cleanup) => {
      dispose = cleanup;
      return useChannelRailActivity(
        () => [row('reply', undefined), row('root', undefined)],
        calls
      );
    });
    expect([...activity.unreadChannelIds()]).toEqual(['root']);
    expect(activity.unreadCount('channels')).toBe(1);
  });

  it.each(['seen', 'done'] as const)(
    'keeps favorite unread state aligned with channel reads, rollback, and new notifications after %s',
    (state) => {
      const [localState, setLocalState] = createSignal<typeof state>();
      source.withLocalState.mockImplementation(
        (notification) => localState() ?? notification.state
      );
      const [channels, setChannels] = createSignal([
        row('favorite', [
          { id: 'n1', state: 'unseen', createdAt: '2026-01-01' },
        ]),
        row('other', []),
      ]);
      const [favorite, setFavorite] = createSignal<Favorite>({
        entityId: 'favorite',
        entityType: 'channel',
        createdAt: '2026-01-01',
        sortOrder: 0,
      });
      const item = createRoot((cleanup) => {
        dispose = cleanup;
        const activity = useChannelRailActivity(channels, calls);
        rail.channelActivity = activity;
        return useChannelRailFavoriteItemState(favorite);
      });

      expect(item().unread).toBe(true);
      setLocalState(state);
      expect(item().unread).toBe(false);
      setLocalState(undefined);
      expect(item().unread).toBe(true);
      setChannels([row('favorite', []), row('other', [])]);
      expect(item().unread).toBe(false);
      setChannels([
        row('favorite', [
          { id: 'n2', state: 'unseen', createdAt: '2026-01-02' },
        ]),
        row('other', []),
      ]);
      expect(item().unread).toBe(true);
      setFavorite((current) => ({ ...current, entityId: 'other' }));
      expect(item().unread).toBe(false);
      expect(source.notifications).not.toHaveBeenCalled();
    }
  );

  it.each(['seen', 'done'] as const)(
    'clears dots, counts, and activity targets immediately on local %s, and restores them on rollback',
    (state) => {
      const [localState, setLocalState] = createSignal<typeof state>();
      source.withLocalState.mockImplementation(
        (notification) => localState() ?? notification.state
      );
      const channels = () => [
        row('one', [{ id: 'n1', state: 'unseen', createdAt: '2026-01-01' }]),
        {
          ...row('dm', [
            { id: 'n2', state: 'unseen', createdAt: '2026-01-01' },
          ]),
          channelType: 'direct_message' as const,
        },
      ];
      const activity = createRoot((cleanup) => {
        dispose = cleanup;
        return useChannelRailActivity(channels, calls);
      });
      expect([...activity.unreadChannelIds()]).toEqual(['one', 'dm']);
      setLocalState(state);
      expect([...activity.unreadChannelIds()]).toEqual([]);
      expect(activity.unreadCount('channels')).toBe(0);
      expect(activity.unreadCount('direct_messages')).toBe(0);
      expect(activity.targetChannelId('channels')).toBeUndefined();
      expect(activity.targetChannelId('direct_messages')).toBeUndefined();
      expect(activity.targetLabel('channels')).toBeUndefined();

      // A failed write rolls back only local intent, without any list refresh.
      setLocalState(undefined);
      expect([...activity.unreadChannelIds()]).toEqual(['one', 'dm']);
      expect(activity.unreadCount('channels')).toBe(1);
      expect(activity.unreadCount('direct_messages')).toBe(1);
      expect(activity.targetChannelId('channels')).toBe('one');
      expect(activity.targetChannelId('direct_messages')).toBe('dm');
      expect(source.notifications).not.toHaveBeenCalled();
    }
  );

  it('suppresses stale read witnesses without hiding another unread notification', () => {
    const [readIds, setReadIds] = createSignal(new Set<string>());
    source.withLocalState.mockImplementation((notification) =>
      readIds().has(notification.id) ? 'seen' : notification.state
    );
    const witness = {
      id: 'n1',
      state: 'unseen' as const,
      createdAt: '2026-01-01',
    };
    const [channels, setChannels] = createSignal([row('one', [witness])]);
    const activity = createRoot((cleanup) => {
      dispose = cleanup;
      return useChannelRailActivity(channels, calls);
    });
    setReadIds(new Set(['n1']));
    expect(activity.unreadCount('channels')).toBe(0);
    setChannels([row('one', [{ ...witness }])]);
    expect(activity.unreadCount('channels')).toBe(0);
    setChannels([row('one', [{ ...witness, id: 'n2' }])]);
    expect(activity.unreadCount('channels')).toBe(1);
    expect(activity.targetChannelId('channels')).toBe('one');
    expect(source.notifications).not.toHaveBeenCalled();
  });

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
