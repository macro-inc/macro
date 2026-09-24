import { createSearchParamsCodec } from '@app/lib/split-router';
import { z } from 'zod';
import type { InboxTab } from './types';

export const inboxTabSearch = {
  namespace: 'inbox',
  schema: z.object({ tab: z.enum(['signal', 'noise', 'reminders']) }),
  defaults: { tab: 'signal' as InboxTab },
};

export const inboxTabSearchCodec = createSearchParamsCodec(inboxTabSearch);
