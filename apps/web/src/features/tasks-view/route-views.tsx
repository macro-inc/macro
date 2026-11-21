import { ProjectBreadcrumb } from '@app/features/projects/project-breadcrumb';
import { ProjectDetail } from '@app/features/projects/project-detail';
import { ProjectTasksProvider } from '@app/features/projects/project-tasks-provider';
import { Projects } from '@app/features/projects/projects';
import {
  createSearchParams,
  SplitRouter,
  useNavigate,
  usePane,
  useParams,
  useRouteParams,
  useSplitRouter,
} from '@app/lib/split-router';
import {
  projectDetailRoute,
  projectTaskRoute,
  tasksSplitRoute,
} from '@app/routes/routes';
import { SplitHeaderScope } from '@components/app/SplitHeaderScope';
import { SidePanel } from '@components/app/side-panel';
import { SplitBackButton } from '@components/app/split-layout/components/SplitHeader';
import {
  AppView,
  RedirectSplit,
  withAuth,
} from '@components/app/split-layout/split-router/app-route-shell';
import { useViewRestoration } from '@components/app/split-layout/view-restoration';
import { viewRestorationKey } from '@components/app/split-layout/view-restoration-key';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import { Show } from 'solid-js';
import { TasksDetailView } from './components/TasksDetailView';
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

export const TasksRouteView = withAuth(() => {
  useViewRestoration();
  const params = useParams<{ taskId?: string; projectId?: string }>();
  const pane = usePane();
  const router = useSplitRouter();
  const workspaceKey = () =>
    viewRestorationKey('tasks', router.entry(pane())?.location);
  return (
    <AppView
      id="tasks"
      detailInlineOnly
      detailRequested={() =>
        typeof params.taskId === 'string' && !params.projectId
      }
      detailFallback={<TasksLegacyRouteView />}
    >
      {/* Each dock destination restores its own entry state on activation. */}
      <Show keyed when={workspaceKey()}>
        {(_workspaceKey) => <TasksView />}
      </Show>
    </AppView>
  );
}, TasksViewSkeleton);

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
  const navigate = useNavigate();
  return (
    <>
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
            <SplitHeaderScope.Pane
              when={isTouchDevice()}
              leading={<SplitBackButton />}
            >
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
            </SplitHeaderScope.Pane>
          </SidePanel.Root>
        )}
      />
    </>
  );
}
