import SpinnerIcon from '@icon/system/regular/spinner.svg';
import { Match, Suspense, Switch } from 'solid-js';
import { TaskList, type TaskListProps } from './components/task-list/TaskList';
import { TasksBoard } from './tasks-board';
import { TasksGantt } from './tasks-gantt';
import { useTasksView } from './tasks-view-context';

export function TasksLoading() {
  return (
    <div class="grid size-full min-h-0 min-w-0 place-items-center text-ink-muted">
      <SpinnerIcon
        aria-hidden={false}
        aria-label="Loading tasks"
        class="size-5 animate-spin"
      />
    </div>
  );
}

/** Renders the selected layout from the host's task scope and navigation capabilities. */
export function TasksContent(props: TaskListProps) {
  const { state } = useTasksView();

  return (
    <Suspense fallback={props.loadingContent ?? <TasksLoading />}>
      <Switch>
        <Match when={state.layout === 'board'}>
          <TasksBoard ref={props.ref} />
        </Match>
        <Match when={state.layout === 'gantt'}>
          <TasksGantt ref={props.ref} />
        </Match>
        <Match when={state.layout === 'list'}>
          <TaskList
            ref={props.ref}
            referencePropertyIds={props.referencePropertyIds}
            emptyContent={props.emptyContent}
            loadingContent={props.loadingContent}
            errorContent={props.errorContent}
          />
        </Match>
      </Switch>
    </Suspense>
  );
}
