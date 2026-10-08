import type { ChannelEntity } from '@entity/types/entity';
import type { WithNotification } from '@entity/types/notification';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchSoup = vi.hoisted(() => vi.fn());
const mapEntity = vi.hoisted(() => vi.fn());
vi.mock('@service-storage/graphql-soup', () => ({
  fetchGraphqlSoup: fetchSoup,
}));
vi.mock('../soup/transform-utils', () => ({
  mapApiSoupItemToEntity: mapEntity,
}));

import { fetchChannelSelectionById } from './selection-by-id';

describe('uncached channel selection', () => {
  beforeEach(() => vi.clearAllMocks());
  it.each([true, false])(
    'loads uncached channel membership (%s) and the complete notification edge together',
    async (isParticipant) => {
      const notifications = [{ id: 'older-mention' }, { id: 'reply' }];
      fetchSoup.mockResolvedValue({
        items: [
          {
            tag: 'channel',
            data: {
              channel: {
                id: 'channel',
                name: 'Channel',
                channel_type: 'private',
                owner_id: 'owner',
              },
              participants: [],
              is_participant: isParticipant,
              notifications,
            },
          },
        ],
        nextCursor: null,
      });
      const mapped: WithNotification<ChannelEntity> = {
        type: 'channel',
        id: 'channel',
        name: 'Channel',
        ownerId: 'owner',
        channelType: 'private',
        isParticipant,
        notifications: () => [],
      };
      mapEntity.mockReturnValue(mapped);
      const full = await fetchChannelSelectionById('channel');
      expect(full).toBe(mapped);
      expect(mapEntity).toHaveBeenCalledWith(
        expect.objectContaining({
          tag: 'channel',
          data: expect.objectContaining({
            is_participant: isParticipant,
            notifications,
          }),
        })
      );
      expect(full.unreadNotifications).toBeUndefined();
      expect(fetchSoup).toHaveBeenCalledWith(
        expect.anything(),
        {
          input: expect.objectContaining({
            initial: expect.objectContaining({
              limit: 1,
              filters: expect.objectContaining({
                channelFilter: { literal: { channelId: 'channel' } },
              }),
            }),
          }),
        },
        { requestPolicy: 'network-only', allowOfflineFallback: false }
      );
    }
  );

  it('rejects an absent channel rather than constructing a partial selection', async () => {
    fetchSoup.mockResolvedValue({ items: [], nextCursor: null });
    await expect(fetchChannelSelectionById('channel')).rejects.toThrow(
      'Conversation is unavailable'
    );
  });

  it('propagates access failures without falling back to cached metadata', async () => {
    const error = new Error('Forbidden');
    fetchSoup.mockRejectedValue(error);
    await expect(fetchChannelSelectionById('channel')).rejects.toBe(error);
  });
});
