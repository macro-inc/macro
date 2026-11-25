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
    sort: z
      .enum([
        'updated_at',
        'created_at',
        'viewed_at',
        'title',
        'status',
        'priority',
        'due_date_earliest',
        'due_date_latest',
        'start_date_earliest',
        'start_date_latest',
      ])
      .optional(),
    sortReversed: z.enum(['true', 'false']).optional(),
    groupBy: z
      .enum([
        'none',
        'status',
        'priority',
        'assignee',
        'project',
        'date',
        'due_date',
        'start_date',
      ])
      .optional(),
    dueDate: z
      .enum([
        'any',
        'overdue',
        'today',
        'tomorrow',
        'next_7_days',
        'later',
        'has_due_date',
        'no_due_date',
        'range',
      ])
      .optional(),
    dueStart: z.iso.date().optional(),
    dueEnd: z.iso.date().optional(),
    startDate: z
      .enum([
        'any',
        'started',
        'today',
        'tomorrow',
        'next_7_days',
        'later',
        'has_start_date',
        'no_start_date',
        'range',
      ])
      .optional(),
    startFrom: z.iso.date().optional(),
    startTo: z.iso.date().optional(),
  }),
  defaults: {
    tab: 'my-tasks' as TasksTab,
    savedView: undefined as string | undefined,
    layout: undefined as TasksViewState['layout'] | undefined,
    sort: undefined as TaskSortId | undefined,
    sortReversed: undefined as 'true' | 'false' | undefined,
    groupBy: undefined as TaskGroupBy | undefined,
    dueDate: undefined,
    dueStart: undefined,
    dueEnd: undefined,
    startDate: undefined,
    startFrom: undefined,
    startTo: undefined,
  },
};

export const tasksTabSearchCodec = createSearchParamsCodec(tasksTabSearch);

export type TasksTabSearchParams = z.infer<typeof tasksTabSearch.schema>;

/** The URL keys for the due-date and start-date filters. */
export function taskDateFilterSearch(filters: {
  dueDate?: TasksViewState['dueDate'];
  startDate?: TasksViewState['startDate'];
}): Pick<
  TasksTabSearchParams,
  'dueDate' | 'dueStart' | 'dueEnd' | 'startDate' | 'startFrom' | 'startTo'
> {
  const { dueDate, startDate } = filters;
  return {
    dueDate: dueDate?.type ?? 'any',
    dueStart: dueDate?.type === 'range' ? dueDate.start : undefined,
    dueEnd: dueDate?.type === 'range' ? dueDate.end : undefined,
    startDate: startDate?.type ?? 'any',
    startFrom: startDate?.type === 'range' ? startDate.start : undefined,
    startTo: startDate?.type === 'range' ? startDate.end : undefined,
  };
}
