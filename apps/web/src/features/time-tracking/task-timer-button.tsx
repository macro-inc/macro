import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableTimeTracking } from '@core/constant/featureFlags';
import { type JSX, Show, Suspense } from 'solid-js';
import { TimeTrackingProvider } from './time-tracking-provider';
import { TaskTimerButton as TaskTimerButtonView } from './views/task-timer-button';

/** Start timer in a desktop task's header, behind `enable-time-tracking`. */
export function TaskTimerButton(props: { taskId: string }): JSX.Element {
  const flag = useFeatureFlag(enableTimeTracking);
  return (
    <Show when={flag().enabled}>
      <Suspense>
        <TimeTrackingProvider>
          <TaskTimerButtonView taskId={props.taskId} />
        </TimeTrackingProvider>
      </Suspense>
    </Show>
  );
}
