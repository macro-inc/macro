import type {
  ApiActivity as ChannelsActivity,
  ApiChannelWithLatest,
} from '@service-comms/generated/models';
import { createSimpleContext } from '.';
import { useListChannelsQuery } from '@queries/channel/channels';
import { useChannelsActivityQuery } from '@queries/channel/activity';
import { createMemo } from 'solid-js';
import { queryReadyGate } from '@queries/gate';

export const { use: useChannelsContext, provider: ChannelsContextProvider } =
  createSimpleContext({
    name: 'ChannelsContext',
    init: () => {
      const channelsQuery = useListChannelsQuery();
      const activityQuery = useChannelsActivityQuery();

      const channelsById = createMemo(() => {
        if (!queryReadyGate(channelsQuery)) return {};
        return channelsQuery.data.reduce<Record<string, ApiChannelWithLatest>>(
          (acc, channel) => {
            acc[channel.id] = channel;
            return acc;
          },
          {}
        );
      });

      const activityByChannelId = createMemo(() => {
        if (!queryReadyGate(activityQuery)) return {};
        return activityQuery.data.reduce<Record<string, ChannelsActivity>>(
          (acc, channel) => {
            acc[channel.id] = channel;
            return acc;
          },
          {}
        );
      });

      return {
        get isLoading() {
          return channelsQuery.isLoading || activityQuery.isLoading;
        },
        get error() {
          return channelsQuery.error ?? activityQuery.error;
        },
        get ready() {
          return !channelsQuery.isLoading;
        },
        get channels() {
          return channelsQuery.data ?? [];
        },
        get channelsById() {
          return channelsById();
        },
        get activityByChannelId() {
          return activityByChannelId();
        },
        get activity() {
          return activityQuery.data;
        },
      };
    },
  });

export function useChannelName(channelId: string, fallback?: string) {
  const { channelsById } = useChannelsContext();
  return createMemo(() => channelsById[channelId]?.name ?? fallback);
}

export function useChannelActivity(channelId: string) {
  const { activityByChannelId } = useChannelsContext();
  return createMemo(() => activityByChannelId[channelId]);
}
