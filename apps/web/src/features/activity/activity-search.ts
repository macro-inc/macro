import { z } from 'zod';
import type { ActivityScope } from './core/event';

/** The Activity screen's search namespace: which feed tab is open. */
export const activitySearch = {
  namespace: 'activity',
  schema: z.object({ scope: z.enum(['mine', 'team']) }),
  defaults: { scope: 'mine' as ActivityScope },
};
