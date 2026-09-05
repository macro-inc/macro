import type { SortDefinition } from '@app/features/soup';
import { compareDateDesc } from '@core/util/date';
import type { TaskEntityWithProperties } from '@entity';
import type { TaskGroupBy, TaskSortId, TaskTab } from './types';

export type TaskTabItem = {
  id: TaskTab;
  label: string;
};

export const PERSONAL_TASK_TABS: TaskTabItem[] = [
  { id: 'my-tasks', label: 'My tasks' },
  { id: 'created-by-me', label: 'Created by me' },
];

export const TEAM_TASK_TABS: TaskTabItem[] = [
  { id: 'team-tasks', label: 'Team tasks' },
];

export const TASK_DEFAULT_GROUP_BY: Record<TaskTab, TaskGroupBy> = {
  'my-tasks': 'priority',
  'created-by-me': 'status',
  'team-tasks': 'priority',
};

export const TASK_GROUP_OPTIONS: {
  id: TaskGroupBy;
  label: string;
}[] = [
  { id: 'none', label: 'None' },
  { id: 'status', label: 'Status' },
  { id: 'priority', label: 'Priority' },
  { id: 'assignee', label: 'Assignee' },
  { id: 'project', label: 'Project' },
  { id: 'date', label: 'Date' },
];

export const TASK_SORT_DEFINITIONS: SortDefinition<
  TaskEntityWithProperties,
  TaskSortId
>[] = [
  {
    id: 'updated_at',
    compare: (left, right) =>
      compareDateDesc(
        left.sortTs ?? left.updatedAt,
        right.sortTs ?? right.updatedAt
      ),
  },
  {
    id: 'created_at',
    compare: (left, right) =>
      compareDateDesc(
        left.sortTs ?? left.createdAt,
        right.sortTs ?? right.createdAt
      ),
  },
  {
    id: 'viewed_at',
    compare: (left, right) =>
      compareDateDesc(
        left.sortTs ?? left.viewedAt,
        right.sortTs ?? right.viewedAt
      ),
  },
];

export const TASK_SORT_OPTIONS: {
  id: TaskSortId;
  label: string;
}[] = [
  { id: 'viewed_at', label: 'Viewed' },
  { id: 'updated_at', label: 'Updated' },
  { id: 'created_at', label: 'Created' },
];
