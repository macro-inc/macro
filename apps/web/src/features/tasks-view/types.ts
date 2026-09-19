import type { FacetSelection, SortSelection } from '@app/features/soup';

export type TaskTab = 'my-tasks' | 'created-by-me' | 'team-tasks';

export type TaskGroupBy =
  | 'none'
  | 'status'
  | 'priority'
  | 'assignee'
  | 'project'
  | 'date';

export type TaskSortId = 'updated_at' | 'created_at' | 'viewed_at';

export type TasksViewState = {
  tab: TaskTab;
  search: string;
  groupBy: TaskGroupBy;
  sort: SortSelection<TaskSortId>[];
  facets: FacetSelection;
  collapsedGroupIds: string[];
  collapsedSidebarSectionIds: string[];
};

export type TasksViewStateOptions = Partial<TasksViewState>;
