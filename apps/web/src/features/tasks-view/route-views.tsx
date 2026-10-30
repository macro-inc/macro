import { ViewBreadcrumbs } from '@app/components/view-shell';
import type { ProjectSection } from '@app/features/projects/core/project';
import {
  ProjectBreadcrumb,
  ProjectDetail,
} from '@app/features/projects/project-detail';
import { Projects } from '@app/features/projects/projects';
import { ProjectTasksProvider } from '@app/features/projects/views/project-tasks-list';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  createSearchParams,
  SplitRouter,
  useNavigate,
  useParams,
  useRouteParams,
} from '@app/lib/split-router';
import {
  projectDetailRoute,
  projectTaskRoute,
  taskDetailRoute,
  tasksSplitRoute,
} from '@app/routes/routes';
import { SidePanel } from '@components/app/side-panel';
import {
  AppView,
  RedirectSplit,
  SignedOutRoute,
  VisitorDetail,
  withVisitor,
} from '@components/app/split-layout/split-router/app-route-shell';
import { LoadingBlock } from '@core/component/LoadingBlock';
import { enableProjects } from '@core/constant/featureFlags';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import { Match, onMount, Show, Switch } from 'solid-js';
import { TaskDetailPanel, TasksDetailView } from './components/TasksDetailView';
import { projectDetailSearch } from './project-detail-search';
import { TasksView } from './tasks-view';
import { TasksViewSkeleton } from './tasks-view-skeleton';

function TasksLegacyRouteView() {
  const params = useParams<{ taskId?: string; projectId?: string }>();
  return (
    <Show when={params.taskId}>
      {(taskId) => <RedirectSplit to={{ type: 'task', id: taskId() }} />}
    </Show>
  );
}

/**
 * Tasks for a caller with no account: the project or task a link opens, alone
 * and read at its own access. The Tasks list itself offers sign-in.
 */
function TasksVisitorView() {
  const params = useParams<{
    projectId?: string;
    section?: ProjectSection;
    taskId?: string;
  }>();
  const navigate = useNavigate();
  const openTask = (taskId: string) =>
    fireAndForget(
      navigate({ route: taskDetailRoute, params: { taskId } }),
      'tasks-view'
    );
  const closeTask = () =>
    fireAndForget(
      params.projectId
        ? navigate({
            route: projectDetailRoute,
            params: {
              projectId: params.projectId,
              section: params.section ?? 'tasks',
            },
          })
        : navigate({ route: tasksSplitRoute, params: {} }),
      'tasks-view'
    );
  const value = () =>
    params.taskId
      ? `task:${params.taskId}`
      : params.projectId
        ? `initiative:${params.projectId}`
        : '';
  return (
    <ViewBreadcrumbs.Root
      value={value()}
      onChange={(next) => {
        if (params.projectId && next === `initiative:${params.projectId}`)
          closeTask();
      }}
    >
      <VisitorDetail>
        <Switch fallback={<SignedOutRoute />}>
          <Match when={params.taskId}>
            {(taskId) => (
              <>
                <Show when={params.projectId}>
                  {(projectId) => (
                    <ProjectBreadcrumb
                      entry={{
                        value: `initiative:${projectId()}`,
                        data: { type: 'initiative', id: projectId() },
                      }}
                      order={1}
                    />
                  )}
                </Show>
                <TaskDetailPanel
                  task={{ id: taskId() }}
                  breadcrumbOrder={params.projectId ? 2 : 1}
                  onClose={closeTask}
                  onDuplicate={openTask}
                />
              </>
            )}
          </Match>
          <Match when={params.projectId}>
            <SplitRouter.Outlet />
          </Match>
        </Switch>
      </VisitorDetail>
    </ViewBreadcrumbs.Root>
  );
}

export const TasksRouteView = withVisitor(
  () => {
    const params = useParams<{ taskId?: string; projectId?: string }>();
    return (
      <AppView
        id="tasks"
        detailDesktopOnly
        detailRequested={() =>
          typeof params.taskId === 'string' && !params.projectId
        }
        detailFallback={<TasksLegacyRouteView />}
      >
        <TasksView />
      </AppView>
    );
  },
  TasksVisitorView,
  TasksViewSkeleton
);

function DisabledProjectRoute() {
  const navigate = useNavigate();
  onMount(() =>
    navigate({ route: tasksSplitRoute, params: {} }, { replace: true })
  );
  return null;
}

export function ProjectTaskRouteView() {
  const params = useParams<{
    projectId: string;
    section: 'overview' | 'tasks';
    taskId: string;
  }>();
  const navigate = useNavigate();
  return (
    <Projects>
      <ProjectTasksProvider
        projectId={params.projectId}
        onOpenTask={(task, options) => {
          const event = options?.event;
          if (
            isTouchDevice() ||
            event?.shiftKey ||
            event?.metaKey ||
            event?.ctrlKey ||
            event?.altKey
          )
            return false;
          fireAndForget(
            navigate({
              route: projectTaskRoute,
              params: {
                projectId: params.projectId,
                section: params.section,
                taskId: task.id,
              },
            }),
            'tasks-view'
          );
          return true;
        }}
      >
        <TasksDetailView
          task={{ id: params.taskId }}
          onClose={() =>
            navigate({
              route: projectDetailRoute,
              params: { projectId: params.projectId, section: params.section },
            })
          }
          breadcrumbOrder={2}
        />
      </ProjectTasksProvider>
    </Projects>
  );
}

export function ProjectDetailRouteView() {
  const params = useRouteParams(projectDetailRoute);
  const [search] = createSearchParams(projectDetailSearch);
  const flag = useFeatureFlag(enableProjects);
  const navigate = useNavigate();
  return (
    <Show
      when={flag().enabled}
      fallback={
        <Show when={!flag().loading} fallback={<LoadingBlock />}>
          <DisabledProjectRoute />
        </Show>
      }
    >
      <ProjectBreadcrumb
        entry={{
          value: `initiative:${params.projectId}`,
          data: { type: 'initiative', id: params.projectId },
        }}
        order={1}
      />
      <SplitRouter.Outlet
        fallback={() => (
          <SidePanel.Root floating defaultOpen={false}>
            <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden">
              <ProjectDetail
                route={{
                  id: params.projectId,
                  section: params.section,
                  discussionId: search.discussionId,
                }}
                onDelete={() =>
                  navigate({ route: tasksSplitRoute, params: {} })
                }
              />
            </div>
          </SidePanel.Root>
        )}
      />
    </Show>
  );
}
