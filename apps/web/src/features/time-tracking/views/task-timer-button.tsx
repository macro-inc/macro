import { t } from '@app/lib/i18n';
import PlayIcon from '@icon/system/fill/play-fill.svg';
import StopIcon from '@icon/system/fill/stop-fill.svg';
import { Button } from '@ui/components/Button';
import { type JSX, Show } from 'solid-js';
import { TimerCount } from '../components/timer-count';
import { useTimeTracking } from '../context/time-tracking-context';
import { formatClock } from '../core/timer-clock';
import { createTimerActions } from './shared/timer-actions';

/**
 * Start timer in a desktop task's header. While this task is timed it shows
 * the live count and stops the timer.
 */
export function TaskTimerButton(props: { taskId: string }): JSX.Element {
  const capabilities = useTimeTracking();
  const timer = capabilities.runningTimer;
  const actions = createTimerActions(capabilities);
  const timingThis = () => timer.timer()?.taskId === props.taskId;
  const disabled = () => timer.busy() || timer.offline();
  const tooltip = () =>
    timer.offline() ? { content: t('timeTracking.timerOffline') } : undefined;

  return (
    <Show
      when={timingThis()}
      fallback={
        <Button
          variant="secondary"
          size="sm"
          disabled={disabled()}
          tooltip={tooltip()}
          onClick={() => actions.start(props.taskId)}
        >
          <PlayIcon class="size-3 shrink-0" />
          {t('timeTracking.startTimer')}
        </Button>
      }
    >
      <Button
        variant="secondary"
        size="sm"
        disabled={disabled()}
        tooltip={tooltip()}
        aria-label={t('timeTracking.stopTimerCount', {
          count: formatClock(timer.seconds()),
        })}
        onClick={actions.stop}
      >
        <StopIcon class="size-3 shrink-0" />
        <TimerCount seconds={timer.seconds()} />
      </Button>
    </Show>
  );
}
