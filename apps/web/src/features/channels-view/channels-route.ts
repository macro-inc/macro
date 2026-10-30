import { createSearchParamsCodec } from '@app/lib/split-router';
import { z } from 'zod';
import type { ChannelsTab } from './types';

export const channelsSearch = {
  namespace: 'channels',
  schema: z
    .object({
      tab: z.enum(['browse', 'unread', 'threads']),
      messageId: z.string(),
      threadId: z.string(),
      seek: z.string(),
    })
    // A thread-only URL targets the root in every conversation host.
    .transform((value) => ({
      ...value,
      messageId: value.messageId || value.threadId,
    })),
  defaults: {
    tab: 'browse' as ChannelsTab,
    messageId: '',
    threadId: '',
    seek: '',
  },
};

export const channelsSearchCodec = createSearchParamsCodec(channelsSearch);
