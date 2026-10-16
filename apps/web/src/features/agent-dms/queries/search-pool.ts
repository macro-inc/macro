import type { ChannelEntity } from '@entity/types/entity';
import { useListChannelsQuery } from '@queries/channel/channels';
import { createMemo } from 'solid-js';

/** The existing complete channel list finds personas beyond the visible soup page. */
export function useAgentDmSearchPool() {
  const channels = useListChannelsQuery();
  return createMemo<ChannelEntity[]>(() =>
    channels.isSuccess
      ? channels.data.flatMap((channel) =>
          channel.agent_dm
            ? [
                {
                  id: channel.id,
                  type: 'channel' as const,
                  name: channel.agent_dm.name,
                  channelType: 'direct_message' as const,
                  ownerId: channel.owner_id,
                  isParticipant: channel.is_participant,
                  participantIds: channel.participants.map(
                    (participant) => participant.user_id
                  ),
                },
              ]
            : []
        )
      : []
  );
}
