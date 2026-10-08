import { createSearchParamsCodec } from '@app/lib/split-router';
import { z } from 'zod';
import { DEFAULT_EMAIL_TAB, EMAIL_TAB_IDS } from './constants';

export const emailTabSearch = {
  namespace: 'mail',
  schema: z.object({ tab: z.enum(EMAIL_TAB_IDS) }),
  defaults: { tab: DEFAULT_EMAIL_TAB },
};

export const emailTabSearchCodec = createSearchParamsCodec(emailTabSearch);

export const EMAIL_DETAIL_SEARCH_NAMESPACE = 'email-detail';

export const emailDetailSearch = {
  namespace: EMAIL_DETAIL_SEARCH_NAMESPACE,
  schema: z.object({ messageId: z.string(), seek: z.string() }),
  defaults: { messageId: '', seek: '' },
};

export const emailDetailSearchCodec =
  createSearchParamsCodec(emailDetailSearch);
