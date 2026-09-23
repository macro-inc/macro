import { createSearchParamsCodec } from '@app/lib/split-router';
import { z } from 'zod';
import type { ChannelsQueryScope, ChannelsTab } from './types';

export const channelsTabSearch = {
  namespace: 'channels',
  schema: z.object({
    tab: z.enum(['browse', 'recents']),
    mobileTab: z.enum(['channels', 'direct_messages', 'recents']),
  }),
  defaults: {
    tab: 'browse' as ChannelsTab,
    mobileTab: 'channels' as ChannelsQueryScope,
  },
};

export const channelsTabSearchCodec =
  createSearchParamsCodec(channelsTabSearch);

export const CHANNEL_DETAIL_SEARCH_NAMESPACE = 'channel-detail';

export const channelDetailSearch = {
  namespace: CHANNEL_DETAIL_SEARCH_NAMESPACE,
  schema: z.object({
    messageId: z.string(),
    threadId: z.string(),
  }),
  defaults: { messageId: '', threadId: '' },
};

export const channelDetailSearchCodec =
  createSearchParamsCodec(channelDetailSearch);
