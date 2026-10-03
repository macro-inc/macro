import { createSearchParamsCodec } from '@app/split-router';
import { z } from 'zod';
import type { TasksTab } from './types';

export const tasksTabSearch = {
  namespace: 'tasks',
  schema: z.object({
    tab: z.enum(['my-tasks', 'created-by-me', 'team-tasks', 'projects']),
  }),
  defaults: { tab: 'my-tasks' as TasksTab },
};

export const tasksTabSearchCodec = createSearchParamsCodec(tasksTabSearch);
