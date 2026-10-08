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

export type TasksViewState = {
  layout: 'list' | 'board' | 'gantt';
  tab: TasksTab;
  search: string;
  groupBy: TaskGroupBy;
  sort: SortSelection<TaskSortId>[];
  facets: FacetSelection;
  collapsedGroupIds: string[];
  collapsedSidebarSectionIds: string[];
};

export type TasksViewStateOptions = Partial<TasksViewState>;
