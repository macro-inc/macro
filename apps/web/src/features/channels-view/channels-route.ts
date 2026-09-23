import { createSearchParamsCodec } from '@app/lib/split-router';
import { z } from 'zod';

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
