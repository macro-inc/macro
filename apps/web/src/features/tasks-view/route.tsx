import { defineRoute, useParams } from '@app/lib/split-router';
import {
  AppView,
  RedirectSplit,
  withAuth,
} from '@components/app/split-layout/split-router/app-route-shell';
import { Show } from 'solid-js';
import { z } from 'zod';
import { TasksDetailRouteView } from './components/TasksDetailView';
import { TasksView } from './tasks-view';

function TasksLegacyRouteView() {
  const params = useParams<{ taskId?: string }>();
  return (
    <Show when={params.taskId}>
      {(taskId) => <RedirectSplit to={{ type: 'task', id: taskId() }} />}
    </Show>
  );
}

export const TasksRouteView = withAuth(() => {
  const params = useParams<{ taskId?: string }>();
  return (
    <AppView
      id="tasks"
      detailDesktopOnly
      detailRequested={() => typeof params.taskId === 'string'}
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
});

export const tasksSplitRoute = defineRoute({
  id: 'view-tasks',
  path: 'tasks',
  component: TasksRouteView,
  search: '*' as const,
  children: [taskDetailRoute],
});
