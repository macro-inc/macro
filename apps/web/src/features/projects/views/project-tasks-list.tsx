import { SearchBar } from '@app/components/view-shell';
import { TasksControls } from '@app/features/tasks-view/components/TasksControls';
import { TaskList } from '@app/features/tasks-view/components/task-list/TaskList';
import {
  TasksViewProvider,
  type TasksViewProviderProps,
  useTasksView,
} from '@app/features/tasks-view/tasks-view-context';
import { useIsMutating } from '@tanstack/solid-query';
import { Button } from '@ui';
import { type ParentProps, Show } from 'solid-js';
import { useProjectsContext } from '../context/projects-context';
import { projectKeys } from '../queries/keys';
import { createProjectTasksDataSource } from '../queries/project-tasks';

export type ProjectTasksProviderProps = ParentProps<{
  projectId: string;
  onOpenTask: NonNullable<TasksViewProviderProps['onOpenTask']>;
}>;

export type ProjectTasksListProps = Omit<
  ProjectTasksProviderProps,
  'children'
> & {
  onCreateTask?: () => void;
  onAddTasks?: () => void;
};

/** Embeds the actual Tasks list, including its controllers, menus and row editors. */
export function ProjectTasksProvider(props: ProjectTasksProviderProps) {
  const context = useProjectsContext();
  const creating = useIsMutating(() => ({
    mutationKey: projectKeys.createTask._def,
  }));
  return (
    <Show when={props.projectId} keyed>
      {(projectId) => (
        <TasksViewProvider
          initialState={{ tab: 'team-tasks', groupBy: 'status', facets: {} }}
          restoreEntryState
          scopeKey={`initiative:${projectId}:tasks`}
          onOpenTask={props.onOpenTask}
          onCloseTask={() => {}}
          sourceFactory={(state, options) =>
            createProjectTasksDataSource(
              context.createProjectSource(() => projectId),
              state,
              { ...options, networkPaused: () => creating() > 0 }
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
  const { state, setState } = useTasksView();
  let listElement: HTMLDivElement | undefined;
  return (
    <div class="flex size-full min-h-0 flex-col">
      <div class="flex min-w-0 flex-wrap items-center gap-3 p-3">
        <SearchBar
          label="Search project tasks"
          placeholder="Search tasks"
          class="min-w-0 max-w-md flex-1"
          value={state.search}
          onValueChange={(search) => setState('search', search)}
          onEscape={() => listElement?.focus()}
        />
        <div class="ml-auto flex shrink-0 items-center gap-3">
          <TasksControls />
          <Show when={props.onAddTasks}>
            <Button onClick={props.onAddTasks}>Add existing tasks</Button>
          </Show>
          <Show when={props.onCreateTask}>
            <Button onClick={props.onCreateTask}>New task</Button>
          </Show>
        </div>
      </div>
      <TaskList
        ref={(element) => {
          listElement = element;
        }}
      />
    </div>
  );
}
