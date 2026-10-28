import {
  type TasksDataSource,
  type TasksDataSourceInput,
  type UseTasksDataSourceOptions,
  useTasksDataSource,
} from '@app/features/tasks-view/queries/use-tasks-query';
import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import type { ProjectSource } from '../context/projects-context';

/**
 * The standard Tasks source scoped to tasks whose Project property names the
 * project, enabled only while the project itself is readable.
 */
export function createProjectTasksDataSource(
  projectId: string,
  project: ProjectSource,
  state: TasksDataSourceInput,
  options: UseTasksDataSourceOptions
): TasksDataSource {
  const source = useTasksDataSource(state, {
    ...options,
    loadAll: true,
    reference: () => ({
      propertyDefinitionId: SYSTEM_PROPERTY_IDS.PROJECT,
      entityId: projectId,
    }),
    enabled: () => Boolean(project.project()),
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
