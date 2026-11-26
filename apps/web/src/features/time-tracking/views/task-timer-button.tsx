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
  const offlineTooltip = () =>
    timer.offline() ? { content: t('timeTracking.timerOffline') } : undefined;

  return (
    <Show
      when={timingThis()}
      fallback={
        <Button
          variant="secondary"
          size="sm"
          class="@max-[48rem]/split-header:gap-0"
          disabled={disabled()}
          aria-label={t('timeTracking.startTimer')}
          tooltip={
            offlineTooltip() ?? { content: t('timeTracking.startTimer') }
          }
          onClick={() => actions.start(props.taskId)}
        >
          <PlayIcon class="size-3 shrink-0" />
          {/* A narrow split keeps room for the task's name in the header. */}
          <span class="@max-[48rem]/split-header:hidden">
            {t('timeTracking.startTimer')}
          </span>
        </Button>
      }
    >
      <Button
        variant="secondary"
        size="sm"
        disabled={disabled()}
        tooltip={offlineTooltip()}
        aria-label={t('timeTracking.stopTimerCount', {
          count: formatClock(timer.seconds()),
        })}
        onClick={actions.stop}
      >
        <StopIcon class="size-3 shrink-0" />
        <TimerCount compact seconds={timer.seconds()} />
      </Button>
    </Show>
  );
}
