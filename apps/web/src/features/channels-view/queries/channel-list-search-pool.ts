import { useChannelsContext } from '@core/context/channels';
import type { ChannelEntity } from '@entity';
import { createMemo } from 'solid-js';

/**
 * Every channel the viewer is in, as search entities. The Soup `search` list
 * holds only its newest page, so the rail's local name search reads this
 * complete list to find a conversation from the first keystroke. Names arrive
 * viewer-resolved: a DM carries the other participant's display name and an
 * agent DM its persona name.
 */
export function useChannelListSearchPool() {
  const { channels } = useChannelsContext();
  return createMemo<ChannelEntity[]>(() =>
    channels().map((channel) => ({
      id: channel.id,
      type: 'channel',
      name: channel.agent_dm?.name ?? (channel.name || 'Unknown Channel'),
      channelType: channel.channel_type,
      ownerId: channel.owner_id,
      isParticipant: channel.is_participant,
      participantIds: channel.participants.map(
        (participant) => participant.user_id
      ),
    }))
  );
}
