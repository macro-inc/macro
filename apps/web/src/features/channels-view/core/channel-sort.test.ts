import type { ChannelEntity } from '@entity';
import { describe, expect, it } from 'vitest';
import { sortChannels } from './channel-sort';

const channel = (
  id: string,
  updatedAt: string,
  unread: { createdAt: string; state?: 'unseen' | 'seen' | 'done' }[] = []
) =>
  ({
    id,
    type: 'channel',
    name: id,
    channelType: 'public',
    updatedAt,
    unreadNotifications: unread.map((notification, index) => ({
      id: `${id}-${index}`,
      state: notification.state ?? 'unseen',
      createdAt: notification.createdAt,
    })),
  }) as ChannelEntity;

const ids = (channels: ChannelEntity[]) => channels.map(({ id }) => id);

describe('sortChannels', () => {
  it('keeps unread channels in place when they get newer messages', () => {
    const before = [
      channel('a', '2026-01-01T10:00:00Z', [
        { createdAt: '2026-01-01T10:00:00Z' },
      ]),
      channel('b', '2026-01-01T10:05:00Z', [
        { createdAt: '2026-01-01T10:05:00Z' },
      ]),
      channel('c', '2026-01-01T10:02:00Z'),
    ];
    expect(ids(sortChannels(before, 'updated_at'))).toEqual(['b', 'c', 'a']);

    const after = [
      channel('a', '2026-01-01T10:10:00Z', [
        { createdAt: '2026-01-01T10:00:00Z' },
        { createdAt: '2026-01-01T10:10:00Z' },
      ]),
      before[1],
      before[2],
    ];
    expect(ids(sortChannels(after, 'updated_at'))).toEqual(['b', 'c', 'a']);
  });

  it('moves a channel up when it first goes unread', () => {
    const channels = [
      channel('a', '2026-01-01T10:10:00Z', [
        { createdAt: '2026-01-01T10:10:00Z' },
      ]),
      channel('b', '2026-01-01T10:05:00Z'),
    ];
    expect(ids(sortChannels(channels, 'updated_at'))).toEqual(['a', 'b']);
  });

  it('sorts read channels by their latest activity', () => {
    const channels = [
      channel('a', '2026-01-01T10:10:00Z', [
        { createdAt: '2026-01-01T10:00:00Z', state: 'seen' },
      ]),
      channel('b', '2026-01-01T10:05:00Z'),
    ];
    expect(ids(sortChannels(channels, 'updated_at'))).toEqual(['a', 'b']);
  });
});
