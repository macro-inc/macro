import { createSearchParamsCodec } from '@app/lib/split-router';
import { z } from 'zod';

export const EMAIL_DETAIL_SEARCH_NAMESPACE = 'email-detail';

export const emailDetailSearch = {
  namespace: EMAIL_DETAIL_SEARCH_NAMESPACE,
  schema: z.object({ messageId: z.string() }),
  defaults: { messageId: '' },
};

export const emailDetailSearchCodec =
  createSearchParamsCodec(emailDetailSearch);
