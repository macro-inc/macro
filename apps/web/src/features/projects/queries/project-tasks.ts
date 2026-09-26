import {
  type TasksDataSource,
  type TasksDataSourceInput,
  type UseTasksDataSourceOptions,
  useTasksDataSource,
} from '@app/features/tasks-view/queries/use-tasks-query';
import type { ProjectSource } from '../context/projects-context';

/** The standard Tasks source scoped to complete, currently authorized membership. */
export function createProjectTasksDataSource(
  project: ProjectSource,
  state: TasksDataSourceInput,
  options: UseTasksDataSourceOptions
): TasksDataSource {
  const source = useTasksDataSource(state, {
    ...options,
    taskIds: () => project.project()?.taskIds ?? [],
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
