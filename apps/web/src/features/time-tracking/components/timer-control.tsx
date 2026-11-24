import { t } from '@app/lib/i18n';
import PlayIcon from '@icon/system/fill/play-fill.svg';
import StopIcon from '@icon/system/fill/stop-fill.svg';
import { cn } from '@ui';
import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import { formatClock } from '../core/timer-clock';
import { TimerCount } from './timer-count';

export type TimerControlProps = {
  /** The person's timer runs on this task. */
  running: boolean;
  seconds: number;
  disabled?: boolean;
  /** Why the control cannot run now, shown as its title. */
  disabledReason?: string;
  onStart: () => void;
  onStop: () => void;
  /** A menu row in a popover, or a full-width button in a sheet. */
  variant: 'row' | 'block';
};

/** Start a timer on the task, or stop the one running on it with its count. */
export function TimerControl(props: TimerControlProps): JSX.Element {
  return (
    <button
      type="button"
      disabled={props.disabled}
      title={props.disabledReason}
      aria-label={
        props.running
          ? t('timeTracking.stopTimerCount', {
              count: formatClock(props.seconds),
            })
          : undefined
      }
      onClick={() => (props.running ? props.onStop() : props.onStart())}
      class={cn(
        'flex w-full items-center gap-2 disabled:opacity-45',
        props.variant === 'row' &&
          'justify-between rounded-md px-2 py-1.5 text-left text-sm text-ink not-touch:hover:bg-hover',
        props.variant === 'block' &&
          'min-h-11 justify-center rounded-full bg-ink px-4 text-sm font-medium text-surface'
      )}
    >
      <Show
        when={props.running}
        fallback={
          <>
            <span class="flex items-center gap-2">
              <PlayIcon class="size-3 shrink-0" />
              {t('timeTracking.startTimer')}
            </span>
            <Show when={props.variant === 'row'}>
              <span class="text-xs text-ink-muted">
                {t('timeTracking.startTimerHint')}
              </span>
            </Show>
          </>
        }
      >
        <span class="flex items-center gap-2">
          <StopIcon class="size-3 shrink-0" />
          {t('timeTracking.stopTimer')}
        </span>
        <TimerCount
          seconds={props.seconds}
          class={props.variant === 'row' ? 'text-xs text-ink-muted' : ''}
        />
      </Show>
    </button>
  );
}
