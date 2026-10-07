import type { FacetSelection, SortSelection } from '@app/features/soup';

export type TaskTab = 'my-tasks' | 'created-by-me' | 'team-tasks' | 'projects';
export type TasksTab = TaskTab;

export type TaskGroupBy =
  | 'none'
  | 'status'
  | 'priority'
  | 'assignee'
  | 'project'
  | 'date';

export type TaskSortId = 'updated_at' | 'created_at' | 'viewed_at';

/** Scopes a task list to tasks whose entity-reference property points at an entity. */
export type TaskReferenceScope = {
  propertyDefinitionId: string;
  entityId: string;
};

export type TaskDetailTarget = {
  id: string;
  fallbackName?: string;
};

/** Due date filter with ISO date strings (YYYY-MM-DD). */
export type TaskDueDateFilter = {
  /** Tasks due on or after this date (inclusive). */
  after?: string;
  /** Tasks due on or before this date (inclusive). */
  before?: string;
};

export type TasksViewState = {
  tab: TasksTab;
  search: string;
  groupBy: TaskGroupBy;
  sort: SortSelection<TaskSortId>[];
  facets: FacetSelection;
  /** Due date range filter for tasks. */
  dueDate: TaskDueDateFilter;
  collapsedGroupIds: string[];
  collapsedSidebarSectionIds: string[];
};

export type TasksViewStateOptions = Partial<TasksViewState>;
