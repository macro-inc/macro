import { formatLocale, t } from '@app/lib/i18n';
import { Button } from '@ui/components/Button';
import { Dialog } from '@ui/components/Dialog';
import type { ManagedDialogProps } from '@ui/components/ImperativeDialog';
import { format } from 'date-fns';
import { createSignal, type JSX, Show } from 'solid-js';
import { dayName, localDay } from '../core/entry-days';
import { formatLength } from '../core/format-length';
import { MAX_ENTRY_MINUTES } from '../core/parse-length';

/** What to log for a timer that ran past the limit. */
export type OverLimitChoice =
  | { kind: 'stopped-at'; endedAt: string }
  | { kind: 'log-all' }
  | { kind: 'discard' };

export type OverLimitDialogProps = ManagedDialogProps & {
  taskName: string;
  startedAt: string;
  /** The server's current time, in ms. */
  nowMs: number;
  onChoose: (choice: OverLimitChoice) => void;
};

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const LOCAL_INPUT = "yyyy-MM-dd'T'HH:mm";

function minutesBetween(fromMs: number, toMs: number): number {
  return Math.max(1, Math.round((toMs - fromMs) / 60_000));
}

function timeOfDay(moment: Date): string {
  return new Intl.DateTimeFormat(formatLocale(), {
    hour: 'numeric',
    minute: '2-digit',
  }).format(moment);
}

function startedLine(taskName: string, start: Date, nowMs: number): string {
  const time = timeOfDay(start);
  const name = dayName(localDay(start), localDay(new Date(nowMs)));
  if (name.kind === 'today') {
    return t('timeTracking.overLimitStartedToday', { task: taskName, time });
  }
  if (name.kind === 'yesterday') {
    return t('timeTracking.overLimitStartedYesterday', {
      task: taskName,
      time,
    });
  }
  const day = new Intl.DateTimeFormat(formatLocale(), {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(name.date);
  return t('timeTracking.overLimitStartedOn', { task: taskName, day, time });
}

/**
 * A timer that ran past the limit: log up to when the person stopped, log all
 * of it (only up to the 24-hour entry limit), or discard it.
 */
export function OverLimitDialog(props: OverLimitDialogProps): JSX.Element {
  const start = () => new Date(props.startedAt);
  const startMs = () => start().getTime();
  const ranMinutes = () => minutesBetween(startMs(), props.nowMs);
  // The field has whole minutes, so the default rounds up to keep a full hour.
  const [stoppedAt, setStoppedAt] = createSignal(
    format(
      Math.min(
        Math.ceil((startMs() + HOUR_MS) / MINUTE_MS) * MINUTE_MS,
        props.nowMs
      ),
      LOCAL_INPUT
    )
  );
  const stoppedMs = () => new Date(stoppedAt()).getTime();
  const stoppedValid = () =>
    !Number.isNaN(stoppedMs()) &&
    stoppedMs() > startMs() &&
    stoppedMs() <= props.nowMs;
  const stoppedHint = () => {
    if (!stoppedValid()) return '';
    const moment = new Date(stoppedMs());
    const day = new Intl.DateTimeFormat(formatLocale(), {
      weekday: 'short',
    }).format(moment);
    return `${day} ${timeOfDay(moment)} · ${formatLength(minutesBetween(startMs(), stoppedMs()))}`;
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange} class="w-96">
      <div class="flex flex-col gap-3 p-5">
        <div class="flex flex-col gap-1">
          <Dialog.Title class="text-base font-semibold text-ink">
            {t('timeTracking.overLimitTitle', {
              length: formatLength(ranMinutes()),
            })}
          </Dialog.Title>
          <Dialog.Description class="text-sm text-ink-muted">
            {startedLine(props.taskName, start(), props.nowMs)}
          </Dialog.Description>
        </div>
        <label class="flex flex-col gap-1 text-xs text-ink-muted">
          {t('timeTracking.stoppedAt')}
          <input
            type="datetime-local"
            class="rounded-md border border-edge-muted bg-transparent px-2 py-1.5 text-sm text-ink"
            value={stoppedAt()}
            min={format(startMs(), LOCAL_INPUT)}
            max={format(props.nowMs, LOCAL_INPUT)}
            onInput={(event) => setStoppedAt(event.currentTarget.value)}
          />
        </label>
        <Button
          variant="primary"
          size="md"
          class="justify-between"
          disabled={!stoppedValid()}
          onClick={() =>
            props.onChoose({
              kind: 'stopped-at',
              endedAt: new Date(stoppedMs()).toISOString(),
            })
          }
        >
          <span>{t('timeTracking.setWhenStopped')}</span>
          <span class="text-xs opacity-80">{stoppedHint()}</span>
        </Button>
        <Show when={ranMinutes() <= MAX_ENTRY_MINUTES}>
          <Button
            variant="outline"
            size="md"
            class="justify-start"
            onClick={() => props.onChoose({ kind: 'log-all' })}
          >
            {t('timeTracking.logAll', { length: formatLength(ranMinutes()) })}
          </Button>
        </Show>
        <Button
          variant="outline"
          size="md"
          class="justify-start"
          onClick={() => props.onChoose({ kind: 'discard' })}
        >
          {t('timeTracking.discard')}
        </Button>
      </div>
    </Dialog>
  );
}
