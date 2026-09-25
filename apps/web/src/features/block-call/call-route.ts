import { createSearchParamsCodec } from '@app/lib/split-router';
import { z } from 'zod';

export const callDetailSearch = {
  namespace: 'call-detail',
  schema: z.object({ transcriptId: z.string(), seek: z.string() }),
  defaults: { transcriptId: '', seek: '' },
};

export const callDetailSearchCodec = createSearchParamsCodec(callDetailSearch);
