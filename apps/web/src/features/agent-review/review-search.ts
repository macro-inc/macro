import { z } from 'zod';
export const reviewSearch = {
  namespace: 'review',
  schema: z.object({
    open: z.boolean(),
    id: z.string(),
    revision: z.number(),
    target: z.string(),
    thread: z.string(),
  }),
  defaults: { open: false, id: '', revision: 0, target: '', thread: '' },
};
