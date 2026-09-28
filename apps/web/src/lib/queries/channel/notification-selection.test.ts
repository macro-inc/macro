import type { ChannelEntity } from '@entity/types/entity';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchNotifications = vi.hoisted(() => vi.fn());
vi.mock('@service-storage/graphql-notifications', () => ({
  fetchGraphqlEntityNotifications: fetchNotifications,
}));

import { hydrateChannelNotificationSelection } from './notification-selection';

const channel = (
  unreadNotifications: ChannelEntity['unreadNotifications']
): ChannelEntity => ({
  id: 'channel',
  type: 'channel',
  name: 'Channel',
  ownerId: 'owner',
  channelType: 'private',
  unreadNotifications,
});

describe('channel selection hydration', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns synchronously for a legacy row', () => {
    const legacy = channel(undefined);
    expect(hydrateChannelNotificationSelection(legacy)).toBe(legacy);
    expect(fetchNotifications).not.toHaveBeenCalled();
  });

  it('refreshes an empty unread witness instead of treating a stale list as read', async () => {
    const incoming = [{ id: 'new-reply' }];
    fetchNotifications.mockResolvedValue(incoming);

    const selection = await hydrateChannelNotificationSelection(channel([]));

    expect(fetchNotifications).toHaveBeenCalledOnce();
    expect(selection.notifications?.()).toEqual(incoming);
  });

  it('returns an empty selection only after refreshing a read channel', async () => {
    fetchNotifications.mockResolvedValue([]);

    const selection = await hydrateChannelNotificationSelection(channel([]));

    expect(fetchNotifications).toHaveBeenCalledOnce();
    expect(selection.notifications?.()).toEqual([]);
  });

  it('uses the complete edge, not the one unread witness, for the selected row', async () => {
    const complete = ['one', 'two', 'thread-reply'].map((id) => ({ id }));
    fetchNotifications.mockResolvedValue(complete);
    const full = await hydrateChannelNotificationSelection({
      ...channel([{ id: 'one', state: 'unseen', createdAt: '2026-01-01' }]),
      target: { messageId: 'explicit-search-target' },
    });
    expect(fetchNotifications).toHaveBeenCalledOnce();
    expect(fetchNotifications.mock.calls[0][1]).toBe('channel');
    expect(full.notifications?.()).toEqual(complete);
    expect(full.unreadNotifications).toBeUndefined();
    expect(full.target?.messageId).toBe('explicit-search-target');
  });

  it('keeps the pre-await channel id if the store proxy loses it mid-fetch', async () => {
    const row = channel([
      { id: 'one', state: 'unseen', createdAt: '2026-01-01' },
    ]);
    fetchNotifications.mockImplementation(async () => {
      (row as { id?: string }).id = undefined;
      return [{ id: 'one' }];
    });
    const full = await hydrateChannelNotificationSelection(row);
    expect(full.id).toBe('channel');
    expect(full.type).toBe('channel');
    expect(full.notifications?.()).toEqual([{ id: 'one' }]);
  });

  it.each([true, false, undefined])(
    'preserves participant status (%s) when the source changes during hydration',
    async (isParticipant) => {
      const row = {
        ...channel([{ id: 'one', state: 'unseen', createdAt: '2026-01-01' }]),
        isParticipant,
      };
      fetchNotifications.mockImplementation(async () => {
        row.isParticipant = undefined;
        return [{ id: 'one' }];
      });

      const full = await hydrateChannelNotificationSelection(row);

      expect(full.isParticipant).toBe(isParticipant);
      expect(full.notifications?.()).toEqual([{ id: 'one' }]);
    }
  );

  it.each<{ unreadNotifications: ChannelEntity['unreadNotifications'] }>([
    { unreadNotifications: [] },
    {
      unreadNotifications: [
        { id: 'one', state: 'unseen', createdAt: '2026-01-01' },
      ],
    },
  ])(
    'does not silently use a partial selection when the refresh fails (%j)',
    async ({ unreadNotifications }) => {
      fetchNotifications.mockRejectedValue(new Error('offline and uncached'));
      await expect(
        hydrateChannelNotificationSelection(channel(unreadNotifications))
      ).rejects.toThrow('offline and uncached');
    }
  );
});
