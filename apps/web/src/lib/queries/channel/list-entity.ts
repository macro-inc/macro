import type { ChannelEntity } from '@entity';
import type { SoupChannel } from '@service-storage/generated/schemas/soupChannel';

/** Shared projection for Soup pages and the persisted channel-list seed. */
export function mapChannelToEntity(
  data: SoupChannel & {
    unreadNotifications?: ChannelEntity['unreadNotifications'];
    unreadMentions?: ChannelEntity['unreadMentions'];
  }
): ChannelEntity {
  const message = (value: SoupChannel['latest_message']) =>
    value
      ? {
          messageId: value.message_id,
          threadId: value.thread_id ?? undefined,
          content: value.content,
          mentions: value.mentions,
          senderId: value.sender_id,
          createdAt: value.created_at,
        }
      : undefined;

  return {
    type: 'channel',
    unreadNotifications: data.unreadNotifications,
    unreadMentions: data.unreadMentions,
    id: data.channel.id,
    name: data.channel.name || 'Unknown Channel',
    channelType: data.channel.channel_type,
    teamId: data.channel.team_id ?? undefined,
    ownerId: data.channel.owner_id,
    updatedAt: data.channel.updated_at,
    createdAt: data.channel.created_at,
    participantIds: data.participants.map((participant) => participant.user_id),
    isParticipant: data.is_participant ?? true,
    viewedAt: data.viewed_at ?? data.interacted_at,
    interactedAt: data.interacted_at,
    latestMessage: message(data.latest_message),
    latestRootMessage: message(data.latest_non_thread_message),
  };
}
