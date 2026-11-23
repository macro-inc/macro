import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableTimeTracking } from '@core/constant/featureFlags';
import { type JSX, Show } from 'solid-js';
import { TimerCount } from './components/timer-count';
import { useRunningTimer } from './running-timer-root';

function TimedTaskCount(props: { taskId: string }): JSX.Element {
  const timer = useRunningTimer();
  return (
    <Show when={timer.timer()?.taskId === props.taskId}>
      <TimerCount chip seconds={timer.seconds()} />
    </Show>
  );
}

/**
 * The live count beside a task the viewer is timing, on its row, card and
 * pill. Other people's timers show nowhere.
 */
export function TaskTimerCount(props: { taskId: string }): JSX.Element {
  const flag = useFeatureFlag(enableTimeTracking);
  return (
    <Show when={flag().enabled}>
      <TimedTaskCount taskId={props.taskId} />
    </Show>
  );
}
