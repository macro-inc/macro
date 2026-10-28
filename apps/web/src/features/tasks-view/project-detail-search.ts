import { z } from 'zod';

export const projectDetailSearch = {
  namespace: 'project',
  schema: z.object({ discussionId: z.string().optional() }),
  defaults: { discussionId: undefined as string | undefined },
};
