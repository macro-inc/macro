// The DM header's channel list, without the channels query.
import { createMemo } from 'solid-js';
import { AGENT_NAME, CHANNEL_ID } from './dm';

export * from '../../../../lib/core/context/channels';

const DM = {
  id: CHANNEL_ID,
  name: AGENT_NAME,
  channel_type: 'direct_message',
  agent_dm: false,
} as const;

export function useChannelsContext() {
  return {
    channels: () => [DM],
    activity: () => [],
    channelsById: () => ({ [CHANNEL_ID]: DM }),
    activityByChannelId: () => ({}),
    isLoading: () => false,
    error: () => null,
  };
}

const channel = (channelId: string) =>
  channelId === CHANNEL_ID ? DM : undefined;

export function useChannel(channelId: string) {
  return createMemo(() => channel(channelId));
}

export function useChannelCanCall(channelId: string) {
  return () => channel(channelId) !== undefined;
}

export function useChannelName(channelId: string, fallback?: string) {
  return () => channel(channelId)?.name ?? fallback;
}

export function useChannelType(channelId: string) {
  return () => channel(channelId)?.channel_type;
}
