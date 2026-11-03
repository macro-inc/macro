import { z } from 'zod';

/** The recommendation to reveal when opening the feed from Home. */
export const feedSearch = {
  namespace: 'forYou',
  schema: z.object({ item: z.string().optional() }),
  defaults: { item: undefined },
};
