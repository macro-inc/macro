import { createSearchParamsCodec } from '@app/lib/split-router';
import { z } from 'zod';

export const routineSearch = {
  namespace: 'routine',
  schema: z.object({ tab: z.enum(['settings', 'history']) }),
  defaults: { tab: 'settings' as 'settings' | 'history' },
};
export const routineSearchCodec = createSearchParamsCodec(routineSearch);
