import { z } from 'zod';

/** The For you page's search namespace: the idea to show first, from Home. */
export const forYouSearch = {
  namespace: 'forYou',
  schema: z.object({ idea: z.string().optional() }),
  defaults: { idea: undefined },
};
