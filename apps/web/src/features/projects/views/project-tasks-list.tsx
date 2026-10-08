import { TasksControls } from '@app/features/tasks-view/components/TasksControls';
import { TasksContent } from '@app/features/tasks-view/tasks-content';
import {
  TasksViewProvider,
  type TasksViewProviderProps,
  useTasksView,
} from '@app/features/tasks-view/tasks-view-context';
import PlusIcon from '@phosphor/plus.svg';
import { Button } from '@ui';
import { type JSX, type ParentProps, Show } from 'solid-js';
import { ProjectTaskSearch } from '../components/project-task-search';
import { useProjectsContext } from '../context/projects-context';
import { createProjectTasksDataSource } from '../queries/project-tasks';

export type ProjectTasksProviderProps = ParentProps<{
  projectId: string;
  onOpenTask: NonNullable<TasksViewProviderProps['onOpenTask']>;
}>;

export type ProjectTasksListProps = Omit<
  ProjectTasksProviderProps,
  'children'
> & {
  projectName: string;
  onCreateTask?: () => void;
  addTasksAction?: JSX.Element;
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
          onCloseTask={() => {}}
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
    >
      <ProjectTasksListBody {...props} />
    </ProjectTasksProvider>
  );
}

function ProjectTasksListBody(props: ProjectTasksListProps) {
  const { state, setState, source } = useTasksView();
  return (
    <div class="flex size-full min-h-0 flex-col">
      <div class="flex h-12 min-w-0 shrink-0 items-center gap-3 overflow-x-auto scrollbar-hidden px-4 py-2">
        <ProjectTaskSearch
          projectName={props.projectName}
          value={state.search}
          onValueChange={(search) => setState('search', search)}
        />
        <div class="ml-auto flex shrink-0 items-center gap-2">
          <TasksControls />
          {props.addTasksAction}
          <Show when={props.onCreateTask}>
            <Button variant="outline" onClick={props.onCreateTask}>
              <PlusIcon class="size-4" />
              New task
            </Button>
          </Show>
        </div>
      </div>
      <Show when={source.paginationError?.()}>
        <div
          role="alert"
          class="flex items-center gap-3 px-3 pb-2 text-sm text-ink-muted"
        >
          Some tasks could not be loaded.
          <Button size="sm" onClick={() => source.retryPagination?.()}>
            Try again
          </Button>
        </div>
      </Show>
      <TasksContent />
    </div>
  );
}
