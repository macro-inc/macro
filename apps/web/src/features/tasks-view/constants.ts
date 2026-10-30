import type { SortDefinition } from '@app/features/soup';
import { t } from '@app/lib/i18n';
import { compareDateDesc } from '@core/util/date';
import type { TaskEntityWithProperties } from '@entity';
import type { ProjectTab, TaskGroupBy, TaskSortId, TasksTab } from './types';

export type TaskTabItem = {
  id: TasksTab;
  label: string;
};

export const BUILT_IN_TASK_TABS: TaskTabItem[] = [
  {
    id: 'my-tasks',
    get label() {
      return t('viewMenus.myTasks');
    },
  },
  {
    id: 'team-tasks',
    get label() {
      return t('viewMenus.allTasks');
    },
  },
  {
    id: 'created-by-me',
    get label() {
      return t('viewMenus.createdByMe');
    },
  },
];

export const PROJECT_TABS: (TaskTabItem & { id: ProjectTab })[] = [
  {
    id: 'my-projects',
    get label() {
      return t('viewMenus.myProjects');
    },
  },
  {
    id: 'projects',
    get label() {
      return t('viewMenus.allProjects');
    },
  },
  {
    id: 'created-projects',
    get label() {
      return t('viewMenus.createdByMe');
    },
  },
];

export const TASK_TABS: TaskTabItem[] = [
  ...BUILT_IN_TASK_TABS,
  ...PROJECT_TABS,
];

export const TASK_DEFAULT_GROUP_BY: Record<TasksTab, TaskGroupBy> = {
  'my-tasks': 'priority',
  'created-by-me': 'status',
  'team-tasks': 'priority',
  projects: 'status',
  'my-projects': 'status',
  'created-projects': 'status',
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
