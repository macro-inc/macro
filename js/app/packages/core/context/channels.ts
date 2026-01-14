import { createMemo, type Accessor } from 'solid-js';
import type {
  ApiActivity as ChannelsActivity,
  ApiChannelWithLatest,
} from '@service-comms/generated/models';
import { useListChannelsQuery } from '@queries/channel/channels';
import { useChannelsActivityQuery } from '@queries/channel/activity';
import { createAssertedContextProvider } from './createContext';

type ChannelsContextValue = {
  channels: Accessor<ApiChannelWithLatest[]>;
  activity: Accessor<ChannelsActivity[] | undefined>;
  channelsById: Accessor<Record<string, ApiChannelWithLatest>>;
  activityByChannelId: Accessor<Record<string, ChannelsActivity>>;
  isLoading: Accessor<boolean>;
  error: Accessor<Error | null>;
};

export const [ChannelsContextProvider, useChannelsContext] =
  createAssertedContextProvider('ChannelsContext', (): ChannelsContextValue => {
    const channelsQuery = useListChannelsQuery();
    const activityQuery = useChannelsActivityQuery();

    const channels = () => channelsQuery.data ?? [];
    const activity = () => activityQuery.data;

    const channelsById = createMemo(() => {
      const data = channelsQuery.data;
      if (!data) return {};
      return data.reduce<Record<string, ApiChannelWithLatest>>((acc, ch) => {
        acc[ch.id] = ch;
        return acc;
      }, {});
    });

    const activityByChannelId = createMemo(() => {
      const data = activityQuery.data;
      if (!data) return {};
      return data.reduce<Record<string, ChannelsActivity>>((acc, a) => {
        acc[a.channel_id] = a;
        return acc;
      }, {});
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
