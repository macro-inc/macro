import { TasksControls } from '@app/features/tasks-view/components/TasksControls';
import { TasksContent } from '@app/features/tasks-view/tasks-content';
import {
  TasksViewProvider,
  type TasksViewProviderProps,
  useTasksView,
} from '@app/features/tasks-view/tasks-view-context';
import { type ParentProps, Show } from 'solid-js';
import { ProjectTaskSearch } from '../components/project-task-search';
import { useProjectsContext } from '../context/projects-context';
import type { ProjectDetail } from '../core/project';
import { createProjectTasksDataSource } from '../queries/project-tasks';
import {
  ProjectTaskActions,
  ProjectTasksEmptyState,
} from './project-task-actions';

export type ProjectTasksProviderProps = ParentProps<{
  projectId: string;
  onOpenTask: NonNullable<TasksViewProviderProps['onOpenTask']>;
  onCreateTask?: TasksViewProviderProps['onCreateTask'];
}>;

export type ProjectTasksListProps = Omit<
  ProjectTasksProviderProps,
  'children'
> & {
  project: ProjectDetail;
};

/** Embeds Tasks layouts with project-scoped data, controllers, menus and editors. */
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
              context.createProjectSource(() => projectId),
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

export function ProjectTasksList(props: ProjectTasksListProps) {
  return (
    <ProjectTasksProvider
      projectId={props.projectId}
      onOpenTask={props.onOpenTask}
      onCreateTask={props.onCreateTask}
    >
      <ProjectTasksListBody {...props} />
    </ProjectTasksProvider>
  );
}

function ProjectTasksListBody(props: ProjectTasksListProps) {
  const { state, setState } = useTasksView();
  return (
    <div class="flex size-full min-h-0 flex-col">
      <div class="flex h-12 min-w-0 shrink-0 items-center gap-3 overflow-x-auto scrollbar-hidden px-4 py-2">
        <ProjectTaskSearch
          projectName={props.project.name}
          value={state.search}
          onValueChange={(search) => setState('search', search)}
        />
        <div class="ml-auto flex shrink-0 items-center gap-2">
          <TasksControls />
          <Show when={props.onCreateTask}>
            {(onCreateTask) => (
              <ProjectTaskActions
                project={props.project}
                onCreateTask={onCreateTask()}
              />
            )}
          </Show>
        </div>
      </div>
      {/* The authorized project detail owns task membership. A filtered or
          disabled layout query cannot decide whether the project is empty. */}
      <Show
        when={props.project.taskIds.length === 0}
        fallback={<TasksContent />}
      >
        <ProjectTasksEmptyState
          project={props.project}
          onCreateTask={props.onCreateTask}
        />
      </Show>
    </div>
  );
}
