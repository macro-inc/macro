import { createMemo, type Accessor } from 'solid-js';
import type {
  ApiActivity as ChannelsActivity,
  ApiChannelWithLatest,
} from '@service-comms/generated/models';
import { useListChannelsQuery } from '@queries/channel/channels';
import { useChannelsActivityQuery } from '@queries/channel/activity';
import { queryReadyGate } from '@queries/gate';
import { createAssertedContextProvider } from './createContext';
import { useUserId } from './user';
import type { LastInteractionTimestamp } from '@core/user/types';

type ChannelsContextValue = {
  channels: Accessor<ApiChannelWithLatest[]>;
  activity: Accessor<ChannelsActivity[]>;
  channelsById: Accessor<Record<string, ApiChannelWithLatest>>;
  activityByChannelId: Accessor<Record<string, ChannelsActivity>>;
  isLoading: Accessor<boolean>;
  error: Accessor<Error | null>;
};

export const [ChannelsContextProvider, useChannelsContext] =
  createAssertedContextProvider('ChannelsContext', (): ChannelsContextValue => {
    const channelsQuery = useListChannelsQuery();
    const activityQuery = useChannelsActivityQuery();

    const channels = () =>
      queryReadyGate(channelsQuery) ? channelsQuery.data : [];
    const activity = () =>
      queryReadyGate(activityQuery) ? activityQuery.data : [];

    const channelsById = createMemo(() => {
      if (!queryReadyGate(channelsQuery)) return {};
      return channelsQuery.data.reduce<Record<string, ApiChannelWithLatest>>(
        (acc, ch) => {
          acc[ch.id] = ch;
          return acc;
        },
        {}
      );
    });

    const activityByChannelId = createMemo(() => {
      if (!queryReadyGate(activityQuery)) return {};
      return activityQuery.data.reduce<Record<string, ChannelsActivity>>(
        (acc, a) => {
          acc[a.channel_id] = a;
          return acc;
        },
        {}
      );
    });

    return {
      channels,
      activity,
      channelsById,
      activityByChannelId,
      isLoading: () => channelsQuery.isLoading || activityQuery.isLoading,
      error: () => channelsQuery.error ?? activityQuery.error ?? null,
    };
  });

export function useChannelName(channelId: string, fallback?: string) {
  const ctx = useChannelsContext();
  return createMemo(() => ctx.channelsById()[channelId]?.name ?? fallback);
}

export function useChannelActivity(channelId: string) {
  const ctx = useChannelsContext();
  return createMemo(() => ctx.activityByChannelId()[channelId]);
}

/**
 * Get a reactive map of userId -> Unix timestamp for the most recent DM
 * activity with that user. Useful for ranking/sorting users by recency of
 * interaction.
 */
export function useDmActivityByUserId(): Accessor<Map<string, number>> {
  const { channels } = useChannelsContext();
  const currentUserId = useUserId();

  return createMemo(() => {
    const currentUser = currentUserId();
    if (!currentUser) return new Map<string, LastInteractionTimestamp>();

    const allChannels = channels();
    const map = new Map<string, LastInteractionTimestamp>();

    for (const channel of allChannels) {
      if (channel.channel_type !== 'direct_message') continue;

      const otherParticipant = channel.participants.find(
        (p) => p.user_id !== currentUser
      );
      if (!otherParticipant) continue;

      const timestamp = channel.updated_at;
      if (timestamp) {
        const date = new Date(timestamp);
        const unixTimestamp = date.getTime();
        map.set(otherParticipant.user_id, unixTimestamp);
      }
    }

    return map;
  });
}
