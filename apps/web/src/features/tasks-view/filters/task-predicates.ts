import { testFacets } from '@app/features/soup';
import { getTaskAssigneeIds, type TaskEntityWithProperties } from '@entity';
import type { TaskTab } from '../types';
import {
  EMPTY_TASK_FACET_CONTEXT,
  TASK_FACETS,
  type TaskFacetContext,
} from './task-facets';

export type TaskViewContext = {
  tab: TaskTab;
  userId: string | undefined;
  facets: Record<string, string[]>;
  facetContext?: TaskFacetContext;
};

export function taskMatchesTab(
  task: TaskEntityWithProperties,
  tab: TaskTab,
  userId: string | undefined
) {
  switch (tab) {
    case 'my-tasks':
      if (!userId) return false;
      return getTaskAssigneeIds(task).includes(userId);
    case 'created-by-me':
      if (!userId) return false;
      return task.ownerId === userId;
    case 'team-tasks':
      return true;
  }
}

export function taskMatchesView(
  task: TaskEntityWithProperties,
  context: TaskViewContext
) {
  if (!taskMatchesTab(task, context.tab, context.userId)) return false;

  return testFacets(
    context.facets,
    TASK_FACETS,
    task,
    context.facetContext ?? EMPTY_TASK_FACET_CONTEXT
  );
}
