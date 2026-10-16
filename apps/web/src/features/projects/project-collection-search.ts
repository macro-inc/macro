import { z } from 'zod';

export const projectCollectionSearch = {
  namespace: 'projects',
  schema: z.object({
    layout: z.enum(['list', 'gantt']).optional(),
  }),
  defaults: {
    layout: undefined as 'list' | 'gantt' | undefined,
  },
};
