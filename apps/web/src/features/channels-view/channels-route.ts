import { createSearchParamsCodec } from '@app/lib/split-router';
import { z } from 'zod';
import type { ChannelsQueryScope, ChannelsTab } from './types';

export const channelsSearch = {
  namespace: 'channels',
  schema: z.object({
    tab: z.enum(['browse', 'recents', 'threads']),
    /** Threads tab: the conversation whose threads are shown; empty for all. */
    threadsChannel: z.string(),
    mobileTab: z.enum(['channels', 'direct_messages', 'recents']),
    messageId: z.string(),
    threadId: z.string(),
    seek: z.string(),
  }),
  defaults: {
    tab: 'browse' as ChannelsTab,
    threadsChannel: '',
    mobileTab: 'channels' as ChannelsQueryScope,
    messageId: '',
    threadId: '',
    seek: '',
  },
};

export const channelsSearchCodec = createSearchParamsCodec(channelsSearch);
