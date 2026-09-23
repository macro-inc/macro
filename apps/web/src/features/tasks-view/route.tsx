import { defineRoute, useParams } from '@app/lib/split-router';
import {
  NewAppView,
  RedirectSplit,
  withAuth,
} from '@components/app/split-layout/split-router/app-route-shell';
import { useUserContext } from '@core/context/user';
import { lazy, Show } from 'solid-js';
import { z } from 'zod';
import { getViewPreset } from '../next-soup/sidebar/soup-filter-presets';

const SoupView = lazy(async () => ({
  default: (await import('../next-soup/soup-view/soup-view')).SoupView,
}));
const TasksView = lazy(async () => ({
  default: (await import('./tasks-view')).TasksView,
}));
const TasksDetailRouteView = lazy(async () => ({
  default: (await import('./components/TasksDetailView')).TasksDetailRouteView,
}));

function LegacyTasksView() {
  const user = useUserContext();
  const preset = getViewPreset('tasks', undefined, {
    userId: user.userId(),
    isTeamAdmin: false,
  });
  return (
    <SoupView
      viewName="Tasks"
      initialFilters={preset?.filters}
      initialClientFilters={preset?.clientFilters}
      initialGroupBy={preset?.groupBy}
    />
  );
}

function TasksLegacyRouteView() {
  const params = useParams<{ taskId?: string }>();
  return (
    <Show when={params.taskId} fallback={<LegacyTasksView />}>
      {(taskId) => <RedirectSplit to={{ type: 'task', id: taskId() }} />}
    </Show>
  );
}

export const TasksRouteView = withAuth(() => {
  const params = useParams<{ taskId?: string }>();
  const detailRequested = () => typeof params.taskId === 'string';

  return (
    <NewAppView
      id="tasks"
      composableOnTouch
      detailDesktopOnly
      detailRequested={detailRequested}
      detailFallback={<TasksLegacyRouteView />}
      fallback={<LegacyTasksView />}
    >
      <TasksView />
    </NewAppView>
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
});

export const tasksSplitRoute = defineRoute({
  id: 'view-tasks',
  path: 'tasks',
  component: TasksRouteView,
  search: '*' as const,
  children: [taskDetailRoute],
});
