import { ViewBreadcrumbs, ViewShell } from '@app/components/view-shell';
import { openProject } from '@app/features/projects/open-project';
import { ProjectsTab } from '@app/features/projects/projects';
import { SplitRouter, useNavigate, useParams } from '@app/lib/split-router';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import { ListEntityMetadataQueryProvider } from '@entity';
import SpinnerIcon from '@phosphor/spinner.svg';
import {
  createSignal,
  onMount,
  type ParentProps,
  Show,
  Suspense,
} from 'solid-js';
import {
  TasksHeader,
  TasksTopBar,
  TaskViewBreadcrumbItem,
} from './components/TasksHeader';
import { TasksMobileTabs } from './components/TasksMobileTabs';
import { TasksSidebar } from './components/TasksSidebar';
import { TaskList } from './components/task-list/TaskList';
import { projectDetailRoute } from './route';
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
  const params = useParams<{
    projectId?: string;
    section?: 'overview' | 'tasks';
  }>();
  const navigate = useNavigate();
  const value = () => {
    const task = selectedTask();
    return task
      ? `task:${task.id}`
      : params.projectId
        ? `initiative:${params.projectId}`
        : 'tasks-view';
  };

  return (
    <ViewBreadcrumbs.Root
      value={value()}
      onChange={(next) => {
        if (next === 'tasks-view') closeTask();
        else if (params.projectId && next === `initiative:${params.projectId}`)
          navigate({
            route: projectDetailRoute,
            params: {
              projectId: params.projectId,
              section: params.section ?? 'overview',
            },
          });
      }}
    >
      <TaskViewBreadcrumbItem />
      {props.children}
    </ViewBreadcrumbs.Root>
  );
}

function TasksViewRoot() {
  const panel = useSplitPanelOrThrow();
  const { state, projectsEnabled } = useTasksView();
  const navigate = useNavigate();
  const layout = useSplitLayout();
  const [listElement, setListElement] = createSignal<HTMLDivElement>();

  onMount(() => panel.handle.setDisplayName('Tasks'));

  const taskList = () => (
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
            <Suspense fallback={<TasksListFallback />}>
              <SplitRouter.Outlet
                fallback={() => (
                  <Show
                    when={state.tab === 'projects' && projectsEnabled()}
                    fallback={taskList()}
                  >
                    <TasksTopBar />
                    <div class="hidden @max-[720px]/view-shell:block">
                      <TasksMobileTabs />
                    </div>
                    <ProjectsTab
                      onOpen={(id, event, newSplit) => {
                        if (
                          newSplit ||
                          event?.shiftKey ||
                          event?.metaKey ||
                          event?.ctrlKey ||
                          event?.altKey
                        ) {
                          openProject(layout, id, {
                            newSplit: newSplit || event?.shiftKey,
                          });
                          return;
                        }
                        navigate({
                          route: projectDetailRoute,
                          params: { projectId: id, section: 'overview' },
                        });
                      }}
                    />
                  </Show>
                )}
              />
            </Suspense>
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
