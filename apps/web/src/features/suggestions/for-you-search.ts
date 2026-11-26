import { z } from 'zod';

/**
 * The For you page's search namespace: the list shown (Today when unset), the
 * topic shown alone, and the suggestion to show first, from Home.
 */
export const forYouSearch = {
  namespace: 'forYou',
  schema: z.object({
    view: z.enum(['today', 'toDo', 'suggestions', 'done']).optional(),
    topic: z.string().optional(),
    suggestion: z.string().optional(),
  }),
  defaults: { view: undefined, topic: undefined, suggestion: undefined },
};
