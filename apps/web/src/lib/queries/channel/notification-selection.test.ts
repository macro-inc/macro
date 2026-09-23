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

  it('does not load history for a read channel or a legacy row', async () => {
    const legacy = channel(undefined);
    expect(await hydrateChannelNotificationSelection(legacy)).toBe(legacy);
    expect(
      (await hydrateChannelNotificationSelection(channel([]))).notifications?.()
    ).toEqual([]);
    expect(fetchNotifications).not.toHaveBeenCalled();
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

  it('does not silently mark a partial selection on a failed full read', async () => {
    fetchNotifications.mockRejectedValue(new Error('offline and uncached'));
    await expect(
      hydrateChannelNotificationSelection(
        channel([{ id: 'one', state: 'unseen', createdAt: '2026-01-01' }])
      )
    ).rejects.toThrow('offline and uncached');
  });
});
