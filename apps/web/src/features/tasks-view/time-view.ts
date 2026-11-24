import type { EntityDetailNavigationOptions } from '@app/components/entity-detail/entity-detail-target';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { type SplitNavigate, useParams } from '@app/lib/split-router';
import { tasksTimeRoute, tasksTimeTaskRoute } from '@app/routes/routes';
import { enableTimeTracking } from '@core/constant/featureFlags';
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
 * Opens a task where the Tasks list would show it: in the week's place on
 * desktop, in the preview pane beside the week on a tablet, with the week in
 * its breadcrumb. On a phone or in a narrow pane (`inline` false), and with a
 * modifier key, it answers false, so the caller opens a split.
 */
export function openTaskFromTime(
  navigate: SplitNavigate,
  view: TasksTimeView,
  taskId: string,
  inline: boolean,
  options?: EntityDetailNavigationOptions
): boolean {
  const event = options?.event;
  if (
    !inline ||
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

/** Back to My week or Team from a task opened from it. */
export function returnToTime(navigate: SplitNavigate, view: TasksTimeView) {
  fireAndForget(
    navigate({ route: tasksTimeRoute, params: { timeView: view } }),
    'tasks-time'
  );
}
