import { createSearchParamsCodec } from '@app/lib/split-router';
import { z } from 'zod';
import type { TaskBoardGrouping } from './core/task-board';
import type { TaskGroupBy, TaskSortId, TasksTab } from './types';

export const tasksTabSearch = {
  namespace: 'tasks',
  schema: z.object({
    tab: z.enum(['my-tasks', 'created-by-me', 'team-tasks', 'projects']),
    sort: z.enum(['updated_at', 'created_at', 'viewed_at']).optional(),
    sortReversed: z.enum(['true', 'false']).optional(),
    groupBy: z
      .enum(['none', 'status', 'priority', 'assignee', 'project', 'date'])
      .optional(),
    boardGroupBy: z
      .enum(['status', 'priority', 'assignee', 'project'])
      .optional(),
  }),
  defaults: {
    tab: 'my-tasks' as TasksTab,
    sort: undefined as TaskSortId | undefined,
    sortReversed: undefined as 'true' | 'false' | undefined,
    groupBy: undefined as TaskGroupBy | undefined,
    boardGroupBy: undefined as TaskBoardGrouping | undefined,
  },
};

export const tasksTabSearchCodec = createSearchParamsCodec(tasksTabSearch);
