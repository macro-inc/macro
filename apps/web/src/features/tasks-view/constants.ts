import type { SortDefinition } from '@app/features/soup';
import {
  type SortSelection,
  sortItems,
} from '@app/features/soup/collection/transforms';
import { compareDateDesc } from '@core/util/date';
import type { TaskEntityWithProperties } from '@entity';
import { getTaskDueDate } from '@entity/utils/task-properties';
import { compareTaskDueDates } from './core/task-due-date';
import type { TaskGroupBy, TaskSortId, TasksTab } from './types';

export type TaskTabItem = {
  id: TasksTab;
  label: string;
};

export const PERSONAL_TASK_TABS: TaskTabItem[] = [
  { id: 'my-tasks', label: 'My tasks' },
  { id: 'created-by-me', label: 'Created by me' },
];

export const TEAM_TASK_TABS: TaskTabItem[] = [
  { id: 'team-tasks', label: 'All tasks' },
];

export const TASK_TABS: TaskTabItem[] = [
  ...PERSONAL_TASK_TABS,
  ...TEAM_TASK_TABS,
  { id: 'projects', label: 'Projects' },
];

export const TASK_DEFAULT_GROUP_BY: Record<TasksTab, TaskGroupBy> = {
  'my-tasks': 'priority',
  'created-by-me': 'status',
  'team-tasks': 'priority',
  projects: 'status',
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
  { id: 'due_date', label: 'Due date' },
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
  {
    id: 'due_date_earliest',
    compare: (left, right) =>
      compareTaskDueDates(
        { id: left.id, dueDate: getTaskDueDate(left) },
        { id: right.id, dueDate: getTaskDueDate(right) }
      ),
  },
  {
    id: 'due_date_latest',
    compare: (left, right) =>
      compareTaskDueDates(
        { id: left.id, dueDate: getTaskDueDate(left) },
        { id: right.id, dueDate: getTaskDueDate(right) },
        true
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
  { id: 'due_date_earliest', label: 'Due date: earliest' },
  { id: 'due_date_latest', label: 'Due date: latest' },
];

/** Due-date directions are separate options; reversal never moves nulls first. */
export function sortTasks(
  items: TaskEntityWithProperties[],
  selections: SortSelection<TaskSortId>[]
): TaskEntityWithProperties[] {
  return sortItems(
    items,
    selections.map((selection) =>
      selection.id.startsWith('due_date_')
        ? { ...selection, reversed: false }
        : selection
    ),
    TASK_SORT_DEFINITIONS
  );
}
