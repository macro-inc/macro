import {
  type TasksDataSource,
  type TasksDataSourceInput,
  type UseTasksDataSourceOptions,
  useTasksDataSource,
} from '@app/features/tasks-view/queries/use-tasks-query';
import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import type {
  ProjectSource,
  ProjectsContext,
} from '../context/projects-context';

/**
 * The standard Tasks source scoped to tasks whose Project property names the
 * project, enabled only while the project itself is readable. Tasks created
 * here show at once, before the list's query lists them.
 */
export function createProjectTasksDataSource(
  projectId: string,
  project: ProjectSource,
  pending: Pick<ProjectsContext, 'pendingTasks' | 'releasePendingTasks'>,
  state: TasksDataSourceInput,
  options: UseTasksDataSourceOptions
): TasksDataSource {
  const source = useTasksDataSource(state, {
    ...options,
    reference: () => ({
      propertyDefinitionId: SYSTEM_PROPERTY_IDS.PROJECT,
      entityId: projectId,
    }),
    enabled: () => Boolean(project.project()),
    optimisticTasks: () => pending.pendingTasks(projectId),
    // The empty state reads the project's own task ids: keep a created task
    // until they list it too, or the first one would hide behind it.
    isOptimisticTaskKnown: (taskId) =>
      project.project()?.taskIds.includes(taskId) ?? false,
    onOptimisticTasksListed: pending.releasePendingTasks,
  });
  return {
    ...source,
    isLoading: () =>
      project.loading() || (Boolean(project.project()) && source.isLoading()),
    error: () => project.error() ?? source.error(),
    refresh: async () => {
      await project.refresh();
      if (project.project()) await source.refresh();
    },
  };
}
