import type { ChannelEntity } from '@entity';
import type { ApiChannelWithLatest } from '@service-storage/channel-list-types';

/** Signup support conversations are named this way on the server. */
export const SUPPORT_CHANNEL_NAME_PREFIX = 'Macro Support x ';

export function isSupportChannelName(name: string | null | undefined): boolean {
  if (!name) return false;
  return name
    .replace(/^#+/, '')
    .trimStart()
    .startsWith(SUPPORT_CHANNEL_NAME_PREFIX);
}

export function isSupportChannel(channel: { name?: string | null }): boolean {
  return isSupportChannelName(channel.name);
}

export function channelEntityFromListItem(
  channel: ApiChannelWithLatest
): ChannelEntity {
  return {
    id: channel.id,
    type: 'channel',
    name: channel.agent_dm?.name ?? (channel.name || 'Unknown Channel'),
    ownerId: channel.owner_id,
    channelType: channel.channel_type,
    isParticipant: channel.is_participant,
    participantIds: channel.participants.map(
      (participant) => participant.user_id
    ),
    createdAt: channel.created_at,
    updatedAt: channel.updated_at,
    viewedAt: channel.viewed_at ?? null,
    interactedAt: channel.interacted_at ?? null,
  };
}

/**
 * Drop support conversations from Chat lists. Search stays unfiltered so
 * staff can still open one by name. The complete channel list fills All
 * when the paged source is mostly support conversations.
 */
export function applySupportChannelVisibility(
  scope: 'channels' | 'direct_messages' | 'recents' | 'search',
  channels: readonly ChannelEntity[],
  extra: readonly ChannelEntity[],
  hide: boolean
): ChannelEntity[] {
  if (scope === 'search' || !hide) return [...channels];

  const visible = channels.filter((channel) => !isSupportChannel(channel));
  if (scope !== 'channels' || extra.length === 0) return visible;

  const byId = new Map<string, ChannelEntity>();
  for (const channel of [...visible, ...extra]) {
    if (!byId.has(channel.id)) byId.set(channel.id, channel);
  }
  return [...byId.values()];
}
