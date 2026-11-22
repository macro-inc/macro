import { TasksControls } from '@app/features/tasks-view/components/TasksControls';
import { TasksContent } from '@app/features/tasks-view/tasks-content';
import { useTasksView } from '@app/features/tasks-view/tasks-view-context';
import { Show } from 'solid-js';
import { ProjectTaskSearch } from '../components/project-task-search';
import { useProjectsContext } from '../context/projects-context';
import type { ProjectDetail } from '../core/project';
import {
  ProjectTasksProvider,
  type ProjectTasksProviderProps,
} from '../project-tasks-provider';
import { ProjectTaskActions } from './project-task-actions';
import { ProjectTasksEmptyState } from './shared/project-tasks-empty-state';

export type ProjectTasksListProps = Omit<
  ProjectTasksProviderProps,
  'children'
> & {
  project: ProjectDetail;
};

export function ProjectTasksList(props: ProjectTasksListProps) {
  return (
    <ProjectTasksProvider
      projectId={props.projectId}
      source={props.source}
      onOpenTask={props.onOpenTask}
      onCreateTask={props.onCreateTask}
    >
      <ProjectTasksListBody {...props} />
    </ProjectTasksProvider>
  );
}

function ProjectTasksListBody(props: ProjectTasksListProps) {
  const { state, setState } = useTasksView();
  const projects = useProjectsContext();
  const hasTasks = () =>
    props.project.taskIds.length > 0 ||
    projects.pendingTasks(props.project.id).length > 0;
  return (
    <div class="flex size-full min-h-0 flex-col touch:pt-(--mobile-content-inset-top) touch:[&>*]:[--mobile-content-inset-top:0px]">
      <div class="flex h-12 min-w-0 shrink-0 items-center gap-3 overflow-x-auto scrollbar-hidden px-4 py-2">
        <ProjectTaskSearch
          projectName={props.project.name}
          value={state.search}
          onValueChange={(search) => setState('search', search)}
        />
        <div class="ml-auto flex shrink-0 items-center gap-2">
          <TasksControls inline />
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
          disabled layout query cannot decide whether the project is empty.
          A task being created here counts until the detail lists it. */}
      <Show
        when={!hasTasks()}
        fallback={
          <TasksContent
            emptyContent={
              <ProjectTasksEmptyState
                project={props.project}
                onCreateTask={props.onCreateTask}
                search={state.search}
              />
            }
          />
        }
      >
        <ProjectTasksEmptyState
          project={props.project}
          onCreateTask={props.onCreateTask}
        />
      </Show>
    </div>
  );
}
