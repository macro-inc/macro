import SpinnerIcon from '@phosphor/spinner.svg';
import { Match, Suspense, Switch } from 'solid-js';
import { TaskList } from './components/task-list/TaskList';
import { TasksBoard } from './tasks-board';
import { TasksGantt } from './tasks-gantt';
import { useTasksView } from './tasks-view-context';

export function TasksLoading() {
  return (
    <div class="grid size-full min-h-0 min-w-0 place-items-center text-ink-muted">
      <SpinnerIcon aria-label="Loading tasks" class="size-5 animate-spin" />
    </div>
  );
}

/** Renders the selected layout from the host's task scope and navigation capabilities. */
export function TasksContent(props: {
  ref?: (element: HTMLDivElement) => void;
}) {
  const { state } = useTasksView();

  return (
    <Suspense fallback={<TasksLoading />}>
      <Switch>
        <Match when={state.layout === 'board'}>
          <TasksBoard ref={props.ref} />
        </Match>
        <Match when={state.layout === 'gantt'}>
          <TasksGantt ref={props.ref} />
        </Match>
        <Match when={state.layout === 'list'}>
          <TaskList ref={props.ref} />
        </Match>
      </Switch>
    </Suspense>
  );
}
