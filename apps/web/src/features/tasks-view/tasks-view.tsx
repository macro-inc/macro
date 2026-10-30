import { ViewBreadcrumbs, ViewShell } from '@app/components/view-shell';
import { openProject } from '@app/features/projects/open-project';
import { ProjectsTab } from '@app/features/projects/projects';
import {
  useSavedView,
  useSavedViews,
} from '@app/features/saved-views/queries/saved-views';
import { ViewTour, ViewTourAction } from '@app/features/tours/ViewTour';
import { SplitRouter, useNavigate, useParams } from '@app/lib/split-router';
import { projectDetailRoute } from '@app/routes/routes';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import { useUserId } from '@core/context/user';
import { fireAndForget } from '@core/util/fireAndForget';
import { ListEntityMetadataQueryProvider } from '@entity';
import { queryReadyGate } from '@queries/gate';
import { useCurrentTeamQuery } from '@queries/team/teams';
import {
  createSignal,
  onMount,
  type ParentProps,
  Show,
  Suspense,
} from 'solid-js';
import { TasksHeader, TaskViewBreadcrumbItem } from './components/TasksHeader';
import { TasksMobileTabs } from './components/TasksMobileTabs';
import { TasksSidebar } from './components/TasksSidebar';
import { TASK_TABS } from './constants';
import { isProjectTab } from './core/task-navigation';
import { TasksContent, TasksLoading } from './tasks-content';
import { TasksViewProvider, useTasksView } from './tasks-view-context';
import { tasksTour } from './tour';
import type { TasksViewStateOptions } from './types';
import {
  TaskSavedViewFailure,
  TaskSavedViewWarning,
} from './views/task-saved-views';

export type TasksViewProps = {
  /** Explicit navigation state. When present, it wins over entry restoration. */
  initialState?: TasksViewStateOptions;
};

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
          fireAndForget(
            navigate({
              route: projectDetailRoute,
              params: {
                projectId: params.projectId,
                section: params.section ?? 'overview',
              },
            }),
            'tasks-view'
          );
      }}
    >
      <TaskViewBreadcrumbItem />
      {props.children}
    </ViewBreadcrumbs.Root>
  );
}

/** The tasks tour's shortcut for bringing existing issues over. */
function ImportLinearAction() {
  const { openWithSplit } = useSplitLayout();
  return (
    <ViewTourAction
      onClick={() => openWithSplit({ type: 'component', id: 'import-linear' })}
    >
      Import from Linear
    </ViewTourAction>
  );
}

function TasksViewRoot() {
  const panel = useSplitPanelOrThrow();
  const { state, setState, projectsEnabled, savedViews } = useTasksView();
  const navigate = useNavigate();
  const layout = useSplitLayout();
  const [listElement, setListElement] = createSignal<HTMLDivElement>();
  const savedViewReady = () => {
    const kind = savedViews?.view().kind;
    return kind !== 'loading' && kind !== 'unavailable';
  };
  const unavailable = () => {
    const view = savedViews?.view();
    return view?.kind === 'unavailable' ? view.message : undefined;
  };

  onMount(() => panel.handle.setDisplayName('Tasks'));

  const taskList = () => (
    <>
      <TasksHeader onSearchEscape={() => listElement()?.focus()} />
      <ViewTour tour={tasksTour} actions={<ImportLinearAction />} />
      <ViewShell.Content class="flex flex-col">
        <Show
          when={savedViewReady()}
          fallback={
            <Show when={unavailable()} fallback={<TasksLoading />}>
              <TaskSavedViewFailure />
            </Show>
          }
        >
          <TaskSavedViewWarning />
          <div class="min-h-0 flex-1">
            <TasksContent ref={setListElement} />
          </div>
        </Show>
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
            <Suspense fallback={<TasksLoading />}>
              <SplitRouter.Outlet
                fallback={() => (
                  <Show
                    when={
                      isProjectTab(state.tab) &&
                      projectsEnabled() &&
                      !state.savedViewActive
                    }
                    fallback={taskList()}
                  >
                    <ProjectsTab
                      scope={() =>
                        state.tab === 'my-projects'
                          ? 'assigned-to-me'
                          : state.tab === 'created-projects'
                            ? 'created-by-me'
                            : 'all'
                      }
                      title={
                        TASK_TABS.find((tab) => tab.id === state.tab)?.label
                      }
                      mobileNavigation={<TasksMobileTabs />}
                      search={{
                        value: () => state.search,
                        onChange: (search) => setState('search', search),
                      }}
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
                        fireAndForget(
                          navigate({
                            route: projectDetailRoute,
                            params: { projectId: id, section: 'overview' },
                          }),
                          'tasks-view'
                        );
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
  const viewerId = useUserId();
  const teamQuery = useCurrentTeamQuery();
  return (
    <ListEntityMetadataQueryProvider>
      <TasksViewProvider
        initialState={props.initialState}
        savedViewsSource={() =>
          useSavedViews({
            viewerId,
            kind: 'tasks',
          })
        }
        savedViewSource={(id) => useSavedView({ viewerId, id })}
        savedViewTeam={() => {
          if (!queryReadyGate(teamQuery)) return;
          const team = teamQuery.data?.team;
          return team ? { id: team.id, name: team.name } : undefined;
        }}
      >
        <TasksViewBreadcrumbs>
          <TasksViewRoot />
        </TasksViewBreadcrumbs>
      </TasksViewProvider>
    </ListEntityMetadataQueryProvider>
  );
}
