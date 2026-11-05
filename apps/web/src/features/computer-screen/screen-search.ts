import { z } from 'zod';

export const screenSearch = {
  namespace: 'screen',
  schema: z.object({ pane: z.enum(['closed', 'split']) }),
  defaults: { pane: 'closed' } as { pane: 'closed' | 'split' },
};
