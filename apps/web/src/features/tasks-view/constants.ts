import type { SortDefinition } from '@app/features/soup';
import {
  type SortSelection,
  sortItems,
} from '@app/features/soup/collection/transforms';
import { t } from '@app/lib/i18n';
import { compareDateDesc } from '@core/util/date';
import type { TaskEntityWithProperties } from '@entity';
import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import type { PropertyDefinitionDomain } from '@property/types';
import { propertyDateSortKey, propertySortKey } from '@property/utils/sort';
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
];

export type TaskPropertySort = {
  propertyDefinitionId: string;
  direction: 'asc' | 'desc';
};

export const TASK_SORT_OPTIONS: {
  id: TaskSortId;
  label: string;
  property?: TaskPropertySort;
}[] = [
  { id: 'viewed_at', label: 'Viewed' },
  { id: 'updated_at', label: 'Updated' },
  { id: 'created_at', label: 'Created' },
  {
    id: 'status',
    label: 'Status',
    property: {
      propertyDefinitionId: SYSTEM_PROPERTY_IDS.STATUS,
      direction: 'asc',
    },
  },
  {
    id: 'priority',
    label: 'Priority',
    property: {
      propertyDefinitionId: SYSTEM_PROPERTY_IDS.PRIORITY,
      direction: 'desc',
    },
  },
  {
    id: 'due_date_earliest',
    label: 'Due soonest',
    property: {
      propertyDefinitionId: SYSTEM_PROPERTY_IDS.DUE_DATE,
      direction: 'asc',
    },
  },
  {
    id: 'due_date_latest',
    label: 'Due furthest away',
    property: {
      propertyDefinitionId: SYSTEM_PROPERTY_IDS.DUE_DATE,
      direction: 'desc',
    },
  },
];

export function taskPropertySort(id: TaskSortId): TaskPropertySort | undefined {
  return TASK_SORT_OPTIONS.find((option) => option.id === id)?.property;
}

/** Property order matches Soup: missing last, then newest update and descending ID. */
export function sortTasks(
  items: TaskEntityWithProperties[],
  selections: SortSelection<TaskSortId>[],
  definitions?: ReadonlyMap<string, PropertyDefinitionDomain>
): TaskEntityWithProperties[] {
  const selection = selections[0];
  const propertySort = selection && taskPropertySort(selection.id);
  if (!propertySort) return sortItems(items, selections, TASK_SORT_DEFINITIONS);
  const definition = definitions?.get(propertySort.propertyDefinitionId);
  // Keep server order until selectable option metadata is available.
  if (selection.id === 'status' || selection.id === 'priority') {
    if (!definition?.options) return items;
  }
  let ascending = propertySort.direction === 'asc';
  if (selection.reversed && !selection.id.startsWith('due_date_'))
    ascending = !ascending;
  const key = (item: TaskEntityWithProperties) =>
    propertySortKey(
      item.properties?.find(
        (property) =>
          property.definition.id === propertySort.propertyDefinitionId
      ),
      definition?.options
    );
  return [...items].sort((left, right) => {
    const a = key(left);
    const b = key(right);
    if (a === undefined && b !== undefined) return 1;
    if (a !== undefined && b === undefined) return -1;
    if (a !== undefined && b !== undefined && a !== b)
      return ascending ? a - b : b - a;
    const updated =
      (propertyDateSortKey(right.updatedAt) ?? 0) -
      (propertyDateSortKey(left.updatedAt) ?? 0);
    if (updated) return updated;
    if (left.id === right.id) return 0;
    return left.id > right.id ? -1 : 1;
  });
}
