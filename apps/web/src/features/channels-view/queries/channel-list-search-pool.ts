import { useChannelDirectory } from '@core/context/channels';
import type { ChannelEntity } from '@entity';
import { toChannelListItem } from '@queries/channel/directory-core';
import { mapChannelToEntity } from '@queries/channel/list-entity';
import { createMemo } from 'solid-js';

/**
 * Every channel the viewer is in, as search entities. The Soup `search` list
 * holds only its newest page, so the rail's local name search reads this
 * complete list to find a conversation from the first keystroke. Names arrive
 * viewer-resolved: a DM carries the other participant's display name and an
 * agent DM its persona name.
 */
export function useChannelListSearchPool() {
  const { channels } = useChannelDirectory();
  return createMemo<ChannelEntity[]>(() =>
    channels().map((record) => {
      const channel = toChannelListItem(record);
      return {
        ...mapChannelToEntity({
          channel,
          participants: channel.participants,
          is_participant: channel.is_participant,
          latest_message: channel.latest_message,
          latest_non_thread_message: channel.latest_non_thread_message,
          viewed_at: channel.viewed_at,
          interacted_at: channel.interacted_at,
        }),
        name: record.agentDm?.name ?? (record.name || 'Unknown Channel'),
      };
    })
  );
}
