import { useQuery } from '@tanstack/solid-query';
import { SERVER_HOSTS } from 'core/constant/servers';
import { platformFetch } from 'core/util/platformFetch';
import type { GetChannelsResponse } from 'service-comms/generated/models/getChannelsResponse';
import type { Accessor } from 'solid-js';
import type { ChannelEntity } from '../types/entity';
import { createApiTokenQuery } from './auth';
import { queryKeys } from './key';

const fetchChannels = async ({ apiToken }: { apiToken?: string }) => {
  if (!apiToken) throw new Error('No API token provided');
  const Authorization = `Bearer ${apiToken}`;

  const response = await platformFetch(
    `${SERVER_HOSTS['comms-service']}/channels`,
    {
      headers: { Authorization },
    }
  );
  if (!response.ok)
    throw new Error('Failed to fetch channels', { cause: response });

  const { channels }: GetChannelsResponse = await response.json();
  return channels;
};

export function createChannelsQuery(options?: {
  disabled?: Accessor<boolean>;
}) {
  const authQuery = createApiTokenQuery();
  return useQuery(() => ({
    queryKey: queryKeys.all.channel,
    queryFn: () => fetchChannels({ apiToken: authQuery.data }),
    select: (data) =>
      data.map(
        (channel): ChannelEntity => ({
          type: 'channel',
          id: channel.id,
          name: channel.name ?? 'Unknown Channel',
          channelType: channel.channel_type,
          ownerId: channel.owner_id,
          frecencyScore: channel.frecency_score,
          createdAt: Date.parse(channel.created_at),
          updatedAt: Date.parse(channel.updated_at),
          particpantIds: channel.participants.map((p) => p.user_id),
          viewedAt: channel.viewed_at
            ? Date.parse(channel.viewed_at)
            : channel.interacted_at
              ? Date.parse(channel.interacted_at)
              : undefined,
          latestMessage: channel.latest_non_thread_message
            ? {
                content: channel.latest_non_thread_message.content,
                senderId: channel.latest_non_thread_message.sender_id,
                createdAt: Date.parse(
                  channel.latest_non_thread_message.created_at
                ),
              }
            : undefined,
        })
      ),
    enabled: authQuery.isSuccess && !options?.disabled?.(),
  }));
}
