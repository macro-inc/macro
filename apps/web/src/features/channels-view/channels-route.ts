import { createSearchParamsCodec } from '@app/lib/split-router';
import { z } from 'zod';
import type { ChannelsQueryScope, ChannelsTab } from './types';

export const channelsSearch = {
  namespace: 'channels',
  schema: z.object({
    tab: z.enum(['browse', 'recents']),
    mobileTab: z.enum(['channels', 'direct_messages', 'recents']),
    messageId: z.string(),
    threadId: z.string(),
  }),
  defaults: {
    tab: 'browse' as ChannelsTab,
    mobileTab: 'channels' as ChannelsQueryScope,
    messageId: '',
    threadId: '',
  },
};

export const channelsSearchCodec = createSearchParamsCodec(channelsSearch);
