import { createSearchParamsCodec, defineRoute } from '@app/lib/split-router';
import { z } from 'zod';

export const supportSearch = {
  namespace: 'support',
  schema: z.object({
    ticket: z.string(),
    companyId: z.string(),
    contactId: z.string(),
  }),
  defaults: { ticket: '', companyId: '', contactId: '' },
};
export const supportSearchCodec = createSearchParamsCodec(supportSearch);
export const supportRoute = defineRoute({
  id: 'view-support',
  path: 'support',
  search: [supportSearch.namespace],
  externalSearch: ['ticket', 'companyId', 'contactId'],
  claim: () => ({ namespace: 'component', id: 'support' }),
});
