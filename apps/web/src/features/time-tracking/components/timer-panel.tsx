import { formatLocale, t } from '@app/lib/i18n';
import StopIcon from '@icon/system/fill/stop-fill.svg';
import { Button } from '@ui/components/Button';
import type { JSX } from 'solid-js';
import { formatClock } from '../core/timer-clock';

export type TimerPanelProps = {
  taskName: string;
  startedAt: string;
  seconds: number;
  disabled?: boolean;
  onStop: () => void;
  onOpenTask: (event: MouseEvent) => void;
  onDiscard: () => void;
};

/** The running timer's card: its task, its count, and what to do with it. */
export function TimerPanel(props: TimerPanelProps): JSX.Element {
  const since = () =>
    new Intl.DateTimeFormat(formatLocale(), {
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(props.startedAt));
  return (
    <div class="flex flex-col gap-2">
      <span class="flex items-center gap-1.5 text-xs text-ink-muted">
        <span
          aria-hidden="true"
          class="size-1.5 shrink-0 rounded-full bg-failure"
        />
        {t('timeTracking.timerRunningSince', { time: since() })}
      </span>
      <span class="truncate text-sm font-semibold text-ink">
        {props.taskName}
      </span>
      <span class="text-2xl font-semibold tabular-nums text-ink">
        {formatClock(props.seconds)}
      </span>
      <div class="flex flex-wrap items-center gap-1.5">
        <Button
          variant="primary"
          size="sm"
          disabled={props.disabled}
          onClick={props.onStop}
        >
          <StopIcon class="size-3 shrink-0" />
          {t('timeTracking.stopTimer')}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onMouseDown={(event: MouseEvent) => event.preventDefault()}
          onClick={(event: MouseEvent) => props.onOpenTask(event)}
        >
          {t('timeTracking.openTask')}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={props.disabled}
          onClick={props.onDiscard}
        >
          {t('timeTracking.discard')}
        </Button>
      </div>
    </div>
  );
}
