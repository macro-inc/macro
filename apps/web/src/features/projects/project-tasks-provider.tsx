import {
  TasksViewProvider,
  type TasksViewProviderProps,
} from '@app/features/tasks-view/tasks-view-context';
import { type ParentProps, Show } from 'solid-js';
import {
  type ProjectSource,
  useProjectsContext,
} from './context/projects-context';
import { createProjectTasksDataSource } from './queries/project-tasks';

export type ProjectTasksProviderProps = ParentProps<{
  projectId: string;
  /** Reuse the host's project read instead of issuing a duplicate request. */
  source?: ProjectSource;
  onOpenTask: NonNullable<TasksViewProviderProps['onOpenTask']>;
  onCreateTask?: TasksViewProviderProps['onCreateTask'];
}>;

/** Both project layouts share one project-scoped task source and controller. */
export function ProjectTasksProvider(props: ProjectTasksProviderProps) {
  const context = useProjectsContext();
  return (
    <Show when={props.projectId} keyed>
      {(projectId) => (
        <TasksViewProvider
          initialState={{ tab: 'team-tasks', groupBy: 'status', facets: {} }}
          restoreEntryState
          scopeKey={`initiative:${projectId}:tasks`}
          searchNamespace="projectTasks"
          onOpenTask={props.onOpenTask}
          onCreateTask={props.onCreateTask}
          onCloseTask={() => {}}
          hideTaskProject
          sourceFactory={(state, options) =>
            createProjectTasksDataSource(
              projectId,
              props.source ?? context.createProjectSource(() => projectId),
              context,
              state,
              options
            )
          }
        >
          {props.children}
        </TasksViewProvider>
      )}
    </Show>
  );
}
