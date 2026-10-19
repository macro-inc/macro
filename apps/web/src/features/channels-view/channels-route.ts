import { createSearchParamsCodec } from '@app/lib/split-router';
import { z } from 'zod';
import type { ChannelsTab } from './types';

export const channelsSearch = {
  namespace: 'channels',
  schema: z.object({
    tab: z.enum(['browse', 'recents', 'threads']),
    messageId: z.string(),
    threadId: z.string(),
    seek: z.string(),
  }),
  defaults: {
    tab: 'browse' as ChannelsTab,
    messageId: '',
    threadId: '',
    seek: '',
  },
};

export const channelsSearchCodec = createSearchParamsCodec(channelsSearch);
