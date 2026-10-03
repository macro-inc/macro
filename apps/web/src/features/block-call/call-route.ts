import { createSearchParamsCodec } from '@app/split-router';
import { z } from 'zod';

export const callDetailSearch = {
  namespace: 'call-detail',
  schema: z.object({
    transcriptId: z.string(),
    messageId: z.string(),
    seek: z.string(),
  }),
  defaults: { transcriptId: '', messageId: '', seek: '' },
};

export const callDetailSearchCodec = createSearchParamsCodec(callDetailSearch);
