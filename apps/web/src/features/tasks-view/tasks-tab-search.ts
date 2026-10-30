import { createSearchParamsCodec } from '@app/lib/split-router';
import { z } from 'zod';
import { TASK_TAB_IDS } from './core/task-navigation';
import type {
  TaskGroupBy,
  TaskSortId,
  TasksTab,
  TasksViewState,
} from './types';

export const tasksTabSearch = {
  namespace: 'tasks',
  schema: z.object({
    tab: z.enum(TASK_TAB_IDS),
    savedView: z
      .string()
      .uuid()
      .transform((id) => id.toLowerCase())
      .optional(),
    layout: z.enum(['list', 'board', 'gantt']).optional(),
    sort: z.enum(['updated_at', 'created_at', 'viewed_at']).optional(),
    sortReversed: z.enum(['true', 'false']).optional(),
    groupBy: z
      .enum(['none', 'status', 'priority', 'assignee', 'project', 'date'])
      .optional(),
  }),
  defaults: {
    tab: 'my-tasks' as TasksTab,
    savedView: undefined as string | undefined,
    layout: undefined as TasksViewState['layout'] | undefined,
    sort: undefined as TaskSortId | undefined,
    sortReversed: undefined as 'true' | 'false' | undefined,
    groupBy: undefined as TaskGroupBy | undefined,
  },
};

export const tasksTabSearchCodec = createSearchParamsCodec(tasksTabSearch);

export type TasksTabSearchParams = z.infer<typeof tasksTabSearch.schema>;
