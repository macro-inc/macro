import {
  EntityDetailNavigationStack,
  useEntityDetailNavigationStack,
} from '@app/components/entity-detail/EntityDetailNavigationStack';
import { ViewBreadcrumbs, ViewShell } from '@app/components/view-shell';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import { ListEntityMetadataQueryProvider } from '@entity';
import SpinnerIcon from '@phosphor/spinner.svg';
import {
  createSignal,
  Match,
  onMount,
  type ParentProps,
  Suspense,
  Switch,
} from 'solid-js';
import { TasksDetailView } from './components/TasksDetailView';
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
  const { closeTask } = useTasksView();
  const navigationStack = useEntityDetailNavigationStack();

  return (
    <ViewBreadcrumbs.Root
      value={navigationStack.active()?.value ?? 'tasks-view'}
      onChange={(value) => {
        if (value === 'tasks-view') {
          closeTask();
          return;
        }
        navigationStack.popTo(value);
      }}
    >
      <TaskViewBreadcrumbItem />
      {props.children}
    </ViewBreadcrumbs.Root>
  );
}

function TasksViewRoot() {
  const panel = useSplitPanelOrThrow();
  const { selectedTask } = useTasksView();
  const [listElement, setListElement] = createSignal<HTMLDivElement>();

  onMount(() => panel.handle.setDisplayName('Tasks'));

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
            <Switch>
              <Match when={selectedTask()}>
                {(task) => <TasksDetailView task={task()} />}
              </Match>
              <Match when={!selectedTask()}>
                <TasksTopBar />
                <ViewShell.Header>
                  <TasksHeader onSearchEscape={() => listElement()?.focus()} />
                </ViewShell.Header>
                <ViewShell.Content>
                  <Suspense fallback={<TasksListFallback />}>
                    <TaskList ref={setListElement} />
                  </Suspense>
                </ViewShell.Content>
              </Match>
            </Switch>
          </ViewShell.Main>
        </ViewShell.Root>
      </SplitPanel.Body>
    </SplitPanel.Root>
  );
}

/** Production Tasks view. */
export function TasksView(props: TasksViewProps) {
  return (
    <EntityDetailNavigationStack.Root
      shouldNavigate={(_, options) => options?.event?.shiftKey !== true}
    >
      <ListEntityMetadataQueryProvider>
        <TasksViewProvider initialState={props.initialState}>
          <TasksViewBreadcrumbs>
            <TasksViewRoot />
          </TasksViewBreadcrumbs>
        </TasksViewProvider>
      </ListEntityMetadataQueryProvider>
    </EntityDetailNavigationStack.Root>
  );
}
