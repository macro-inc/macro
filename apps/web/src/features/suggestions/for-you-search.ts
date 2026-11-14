import { z } from 'zod';

/** The For you page's search namespace: the suggestion to show first, from Home. */
export const forYouSearch = {
  namespace: 'forYou',
  schema: z.object({ suggestion: z.string().optional() }),
  defaults: { suggestion: undefined },
};
