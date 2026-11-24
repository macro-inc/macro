import type { EntityDetailNavigationOptions } from '@app/components/entity-detail/entity-detail-target';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { type SplitNavigate, useParams } from '@app/lib/split-router';
import { tasksTimeRoute, tasksTimeTaskRoute } from '@app/routes/routes';
import { enableTimeTracking } from '@core/constant/featureFlags';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import type { Accessor } from 'solid-js';

export type TasksTimeView = 'week' | 'team';

/**
 * My week or Team, when the route opens the Time section. A flag still
 * loading keeps it, so a Time link does not show the task list first.
 */
export function useTasksTimeView(): Accessor<TasksTimeView | undefined> {
  const params = useParams<{ timeView?: string }>();
  const flag = useFeatureFlag(enableTimeTracking);
  return () => {
    const view = params.timeView;
    if (view !== 'week' && view !== 'team') return undefined;
    const state = flag();
    return state.enabled || state.loading ? view : undefined;
  };
}

/**
 * Opens a task beside My week or Team, as a project's task opens beside its
 * section. Touch and modifier clicks answer false, so the caller opens a split.
 */
export function openTaskBesideTime(
  navigate: SplitNavigate,
  view: TasksTimeView,
  taskId: string,
  options?: EntityDetailNavigationOptions
): boolean {
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
    navigate({ route: tasksTimeTaskRoute, params: { timeView: view, taskId } }),
    'tasks-time'
  );
  return true;
}

/** Back to My week or Team from a task opened beside it. */
export function returnToTime(navigate: SplitNavigate, view: TasksTimeView) {
  fireAndForget(
    navigate({ route: tasksTimeRoute, params: { timeView: view } }),
    'tasks-time'
  );
}
