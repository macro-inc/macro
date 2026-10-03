import { createSearchParamsCodec } from '@app/lib/split-router';
import { z } from 'zod';
import type { HomeTab } from './types';

export const homeTabSearch = {
  namespace: 'home',
  schema: z.object({ tab: z.enum(['signal', 'noise', 'reminders']) }),
  defaults: { tab: 'signal' as HomeTab },
};

export const homeTabSearchCodec = createSearchParamsCodec(homeTabSearch);
