import type { EntityDetailNavigationOptions } from '@app/components/entity-detail/entity-detail-target';
import {
  CollectionPanes,
  ViewBreadcrumbs,
  ViewShell,
  ViewSidebar,
} from '@app/components/view-shell';
import { MobileListLayout } from '@app/components/view-shell/MobileListLayout';
import { useInlinePreviewLayout } from '@app/components/view-shell/use-inline-preview-layout';
import type { ProjectSection } from '@app/features/projects/core/project';
import { openProject } from '@app/features/projects/open-project';
import { ProjectSavedViewsProvider } from '@app/features/projects/project-saved-views';
import { ProjectsTab } from '@app/features/projects/projects';
import {
  useSavedView,
  useSavedViews,
} from '@app/features/saved-views/queries/saved-views';
import { SavedViewDraftHost } from '@app/features/saved-views/views/saved-view-draft-host';
import { TasksTime } from '@app/features/time-tracking/tasks-time';
import { ViewTour, ViewTourAction } from '@app/features/tours/ViewTour';
import { TutorialRow } from '@app/features/video-tutorials';
import { SplitRouter, useNavigate, useParams } from '@app/lib/split-router';
import { projectDetailRoute, tasksProjectsRoute } from '@app/routes/routes';
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
import { TasksMobileControls } from './components/TasksMobileControls';

import { TasksSidebar } from './components/TasksSidebar';
import { TASK_TABS } from './constants';
import {
  isProjectTab,
  projectScopeForTab,
  projectTabForScope,
} from './core/task-navigation';
import { TasksContent, TasksLoading } from './tasks-content';
import { TasksViewProvider, useTasksView } from './tasks-view-context';
import { openTaskFromTime, returnToTime, useTasksTimeView } from './time-view';
import { tasksTour } from './tour';
import type { TaskDetailTarget, TasksViewStateOptions } from './types';
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
    section?: ProjectSection;
  }>();
  const navigate = useNavigate();
  const timeView = useTasksTimeView();
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
        if (next === 'tasks-view') {
          const view = timeView();
          if (view) returnToTime(navigate, view);
          else closeTask();
        } else if (
          params.projectId &&
          next === `initiative:${params.projectId}`
        )
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

function TasksProjectViews(props: ParentProps) {
  const { state, registerProjectViewLeave } = useTasksView();
  const navigate = useNavigate();
  const params = useParams<{ projectId?: string; taskId?: string }>();
  return (
    <ProjectSavedViewsProvider
      enabled={() => true}
      active={() => isProjectTab(state.tab) && !state.savedViewActive}
      registerLeave={registerProjectViewLeave}
      scope={() => projectScopeForTab(state.tab)}
      location={() => ({
        projectId: params.projectId,
        taskId: params.taskId,
        tab: state.tab,
      })}
      onSelect={(id, scope = 'all') => {
        const tab = projectTabForScope(scope);
        fireAndForget(
          navigate(
            { route: tasksProjectsRoute, params: { projectsTab: 'projects' } },
            {
              search: {
                tasks: { tab: [tab] },
                projects: id ? { savedView: [id] } : {},
              },
            }
          ),
          'project-views'
        );
      }}
    >
      {props.children}
    </ProjectSavedViewsProvider>
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
  const {
    state,
    setState,
    savedViews,
    selectedTask,
    savedViewCreation,
    savedViewsList,
    discardNewSavedView,
    openTask,
  } = useTasksView();
  const params = useParams<{ projectId?: string }>();
  const timeView = useTasksTimeView();
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
    <MobileListLayout
      header={
        <TasksMobileControls
          focusSearchResults={() => listElement()?.focus()}
        />
      }
    >
      <TasksHeader focusSearchResults={() => listElement()?.focus()} />
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
          <div class="min-h-0 flex-1">
            <TasksContent
              ref={setListElement}
              listStart={
                // Task rows lead with priority and status icons; the inset
                // puts the play icon over the status icon and the label
                // over the task titles, while the row's hover still spans
                // the list like the task rows'.
                <>
                  <TaskSavedViewWarning />
                  <div class="[--tutorial-row-inset:2.25rem]">
                    <TutorialRow tutorial="tasks" />
                  </div>
                </>
              }
            />
          </div>
        </Show>
      </ViewShell.Content>
    </MobileListLayout>
  );

  return (
    <SplitPanel.Root>
      <Show when={savedViewCreation && savedViewsList}>
        <SavedViewDraftHost
          creation={savedViewCreation!}
          refresh={savedViewsList!.refresh}
          discard={discardNewSavedView}
          selection={{ tasks: ['tab', 'savedView'], projects: ['savedView'] }}
        />
      </Show>
      <SplitPanel.Body>
        <ViewShell.Root
          contentLayout="collection"
          asidePreferenceKey="tasks"
          resizable
          aside={{ preserveDuringResize: false }}
          main={{ preferredWidth: 640 }}
        >
          <ViewShell.Aside>
            <TasksSidebar />
          </ViewShell.Aside>
          <CollectionPanes
            hasDetail={!!selectedTask() || !!params.projectId}
            list={
              <Show
                when={timeView()}
                fallback={
                  <Show
                    when={isProjectTab(state.tab) && !state.savedViewActive}
                    fallback={taskList()}
                  >
                    <ProjectsTab
                      scope={() => projectScopeForTab(state.tab)}
                      title={
                        TASK_TABS.find((tab) => tab.id === state.tab)?.label
                      }
                      mobileNavigation={
                        <ViewSidebar.Toggle
                          action="expand"
                          presentation="pill"
                        />
                      }
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
                }
              >
                {(view) => (
                  <TasksTime
                    view={view()}
                    onOpenTask={(task, options) => {
                      if (openTask(task, options)) return true;
                      layout.openWithSplit(
                        { type: 'task', id: task.id },
                        { preferNewSplit: options?.event?.shiftKey }
                      );
                      return true;
                    }}
                    navigation={
                      <ViewSidebar.Toggle action="expand" presentation="pill" />
                    }
                  />
                )}
              </Show>
            }
          >
            <Suspense fallback={<TasksLoading />}>
              <SplitRouter.Outlet />
            </Suspense>
          </CollectionPanes>
        </ViewShell.Root>
      </SplitPanel.Body>
    </SplitPanel.Root>
  );
}

/** Production Tasks view. */
export function TasksView(props: TasksViewProps) {
  const viewerId = useUserId();
  const teamQuery = useCurrentTeamQuery();
  const timeView = useTasksTimeView();
  const navigate = useNavigate();
  const inlinePreview = useInlinePreviewLayout();
  const openFromTime = (
    task: TaskDetailTarget,
    options?: EntityDetailNavigationOptions
  ) => {
    const view = timeView();
    return view
      ? openTaskFromTime(navigate, view, task.id, inlinePreview(), options)
      : false;
  };
  return (
    <ListEntityMetadataQueryProvider>
      <TasksViewProvider
        initialState={props.initialState}
        onOpenTask={timeView() ? openFromTime : undefined}
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
        <TasksProjectViews>
          <TasksViewBreadcrumbs>
            <TasksViewRoot />
          </TasksViewBreadcrumbs>
        </TasksProjectViews>
      </TasksViewProvider>
    </ListEntityMetadataQueryProvider>
  );
}
