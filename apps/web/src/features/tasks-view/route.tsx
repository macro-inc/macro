import {
  ProjectBreadcrumb,
  ProjectDetail,
} from '@app/features/projects/project-detail';
import { Projects } from '@app/features/projects/projects';
import { ProjectTasksProvider } from '@app/features/projects/views/project-tasks-list';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  createSearchParams,
  defineRoute,
  SplitRouter,
  useNavigate,
  useParams,
  useRouteParams,
} from '@app/lib/split-router';
import { URL_PARAMS as MARKDOWN_URL_PARAMS } from '@block-md/constants';
import { SidePanel } from '@components/app/side-panel';
import {
  AppView,
  RedirectSplit,
  withAuth,
} from '@components/app/split-layout/split-router/app-route-shell';
import { uuidRouteReference } from '@components/app/split-layout/split-router/mention-links';
import { LoadingBlock } from '@core/component/LoadingBlock';
import { enableProjects } from '@core/constant/featureFlags';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { onMount, Show } from 'solid-js';
import { z } from 'zod';
import {
  TasksDetailRouteView,
  TasksDetailView,
} from './components/TasksDetailView';
import { TasksView } from './tasks-view';

function TasksLegacyRouteView() {
  const params = useParams<{ taskId?: string; projectId?: string }>();
  return (
    <Show when={params.taskId}>
      {(taskId) => <RedirectSplit to={{ type: 'task', id: taskId() }} />}
    </Show>
  );
}

export const TasksRouteView = withAuth(() => {
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
});

export const taskDetailRoute = defineRoute({
  id: 'tasks-task',
  path: ':taskId',
  params: z.object({ taskId: z.string().min(1) }),
  component: TasksDetailRouteView,
  remountKey: ({ taskId }) => taskId,
  claim: ({ taskId }) => ({
    namespace: 'block',
    id: `md:${taskId}`,
  }),
  toReference: ({ taskId }) => uuidRouteReference(taskId, 'task'),
  externalSearch: Object.values(MARKDOWN_URL_PARAMS),
});

export const projectDetailSearch = {
  namespace: 'project',
  schema: z.object({ discussionId: z.string().optional() }),
  defaults: { discussionId: undefined as string | undefined },
};

function DisabledProjectRoute() {
  const navigate = useNavigate();
  onMount(() =>
    navigate({ route: tasksSplitRoute, params: {} }, { replace: true })
  );
  return null;
}

function ProjectTaskRouteView() {
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
          navigate({
            route: projectTaskRoute,
            params: {
              projectId: params.projectId,
              section: params.section,
              taskId: task.id,
            },
          });
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

function ProjectDetailRouteView() {
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
          <SidePanel.Root>
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

export const projectTaskRoute = defineRoute({
  id: 'tasks-project-task',
  path: 'task/:taskId',
  params: z.object({ taskId: z.string().min(1) }),
  component: ProjectTaskRouteView,
  remountKey: ({ taskId }) => taskId,
  claim: ({ taskId }) => ({ namespace: 'block', id: `md:${taskId}` }),
  toReference: ({ taskId }) => uuidRouteReference(taskId, 'task'),
  externalSearch: Object.values(MARKDOWN_URL_PARAMS),
});

export const projectDetailRoute = defineRoute({
  id: 'tasks-project',
  path: 'projects/:projectId/:section',
  params: z.object({
    projectId: z.string().uuid(),
    section: z.enum(['overview', 'tasks']),
  }),
  component: ProjectDetailRouteView,
  remountKey: ({ projectId }) => projectId,
  claim: ({ projectId }) => ({
    namespace: 'block',
    id: `initiative:${projectId}`,
  }),
  toReference: ({ projectId }) => uuidRouteReference(projectId, 'initiative'),
  children: [projectTaskRoute],
});

export const tasksProjectsRoute = defineRoute({
  id: 'tasks-projects',
  path: 'projects',
  params: z.object({}).transform(() => ({ projectsTab: 'projects' as const })),
});

export const tasksSplitRoute = defineRoute({
  id: 'view-tasks',
  path: 'tasks',
  component: TasksRouteView,
  search: '*' as const,
  children: [projectDetailRoute, tasksProjectsRoute, taskDetailRoute],
});
