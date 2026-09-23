import { ViewBreadcrumbs, ViewShell } from '@app/components/view-shell';
import { SplitRouter } from '@app/lib/split-router';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import { ListEntityMetadataQueryProvider } from '@entity';
import SpinnerIcon from '@phosphor/spinner.svg';
import { createSignal, onMount, type ParentProps, Suspense } from 'solid-js';
import {
  TasksHeader,
  TasksTopBar,
  TaskViewBreadcrumbItem,
} from './components/TasksHeader';
import { TasksSidebar } from './components/TasksSidebar';
import { TaskList } from './components/task-list/TaskList';
import { TasksViewProvider, useTasksView } from './tasks-view-context';
import type { TasksViewStateOptions } from './types';

export type TasksViewProps = {
  /** Explicit navigation state. When present, it wins over entry restoration. */
  initialState?: TasksViewStateOptions;
};

function TasksListFallback() {
  return (
    <div class="grid size-full min-h-0 min-w-0 place-items-center text-ink-muted">
      <SpinnerIcon aria-label="Loading tasks" class="size-5 animate-spin" />
    </div>
  );
}

function TasksViewBreadcrumbs(props: ParentProps) {
  const { closeTask, selectedTask } = useTasksView();
  const value = () => {
    const task = selectedTask();
    return task ? `task:${task.id}` : 'tasks-view';
  };

  return (
    <ViewBreadcrumbs.Root
      value={value()}
      onChange={(next) => {
        if (next === 'tasks-view') closeTask();
      }}
    >
      <TaskViewBreadcrumbItem />
      {props.children}
    </ViewBreadcrumbs.Root>
  );
}

function TasksViewRoot() {
  const panel = useSplitPanelOrThrow();
  const [listElement, setListElement] = createSignal<HTMLDivElement>();

  onMount(() => panel.handle.setDisplayName('Tasks'));

  const list = () => (
    <>
      <TasksTopBar />
      <ViewShell.Header>
        <TasksHeader onSearchEscape={() => listElement()?.focus()} />
      </ViewShell.Header>
      <ViewShell.Content>
        <Suspense fallback={<TasksListFallback />}>
          <TaskList ref={setListElement} />
        </Suspense>
      </ViewShell.Content>
    </>
  );

  return (
    <SplitPanel.Root>
      <SplitPanel.Body>
        <ViewShell.Root
          asidePreferenceKey="tasks"
          resizable
          aside={{ preserveDuringResize: false }}
          main={{ preferredWidth: 640 }}
        >
          <ViewShell.Aside>
            <TasksSidebar />
          </ViewShell.Aside>
          <ViewShell.Main>
            <SplitRouter.Outlet fallback={list} />
          </ViewShell.Main>
        </ViewShell.Root>
      </SplitPanel.Body>
    </SplitPanel.Root>
  );
}

/** Production Tasks view. */
export function TasksView(props: TasksViewProps) {
  return (
    <ListEntityMetadataQueryProvider>
      <TasksViewProvider initialState={props.initialState}>
        <TasksViewBreadcrumbs>
          <TasksViewRoot />
        </TasksViewBreadcrumbs>
      </TasksViewProvider>
    </ListEntityMetadataQueryProvider>
  );
}
