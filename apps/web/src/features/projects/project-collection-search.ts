import { z } from 'zod';

export const projectCollectionSearch = {
  namespace: 'projects',
  schema: z.object({
    savedView: z.string().uuid().optional(),
    layout: z.enum(['list', 'gantt']).optional(),
  }),
  defaults: {
    layout: undefined as 'list' | 'gantt' | undefined,
    savedView: undefined as string | undefined,
  },
};
