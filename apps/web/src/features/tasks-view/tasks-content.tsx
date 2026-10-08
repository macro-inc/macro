import SpinnerIcon from '@phosphor/spinner.svg';
import { Show, Suspense } from 'solid-js';
import { TaskList } from './components/task-list/TaskList';
import { TasksBoard } from './tasks-board';
import { useTasksView } from './tasks-view-context';

export function TasksLoading() {
  return (
    <div class="grid size-full min-h-0 min-w-0 place-items-center text-ink-muted">
      <SpinnerIcon aria-label="Loading tasks" class="size-5 animate-spin" />
    </div>
  );
}

/** Renders either layout from the host's task scope and navigation capabilities. */
export function TasksContent(props: {
  ref?: (element: HTMLDivElement) => void;
}) {
  const { state } = useTasksView();

  return (
    <Suspense fallback={<TasksLoading />}>
      <Show
        when={state.layout === 'board'}
        fallback={<TaskList ref={props.ref} />}
      >
        <TasksBoard ref={props.ref} />
      </Show>
    </Suspense>
  );
}
