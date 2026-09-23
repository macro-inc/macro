import { createSearchParamsCodec } from '@app/lib/split-router';
import { z } from 'zod';
import type { TaskTab } from './types';

export const tasksTabSearch = {
  namespace: 'tasks',
  schema: z.object({
    tab: z.enum(['my-tasks', 'created-by-me', 'team-tasks']),
  }),
  defaults: { tab: 'my-tasks' as TaskTab },
};

export const tasksTabSearchCodec = createSearchParamsCodec(tasksTabSearch);
