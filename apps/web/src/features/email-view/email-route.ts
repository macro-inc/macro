import { createSearchParamsCodec } from '@app/lib/split-router';
import { z } from 'zod';
import type { EmailTab } from './types';

export const emailTabSearch = {
  namespace: 'mail',
  schema: z.object({
    tab: z.enum([
      'important',
      'noise',
      'sent',
      'calendar',
      'drafts',
      'shared',
      'all',
    ]),
  }),
  defaults: { tab: 'important' as EmailTab },
};

export const emailTabSearchCodec = createSearchParamsCodec(emailTabSearch);

export const EMAIL_DETAIL_SEARCH_NAMESPACE = 'email-detail';

export const emailDetailSearch = {
  namespace: EMAIL_DETAIL_SEARCH_NAMESPACE,
  schema: z.object({ messageId: z.string() }),
  defaults: { messageId: '' },
};

export const emailDetailSearchCodec =
  createSearchParamsCodec(emailDetailSearch);
