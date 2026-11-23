import { t } from '@app/lib/i18n';
import { Button } from '@ui/components/Button';
import { Input } from '@ui/components/Input';
import { createSignal, type JSX, Show } from 'solid-js';
import type { TimeEntryValues } from '../core/entry-values';
import { formatLength } from '../core/format-length';
import { MAX_ENTRY_MINUTES, parseLength } from '../core/parse-length';

type EntryFormProps = {
  /** Values to start from: a new entry's length and day, or an entry to edit. */
  initial: {
    minutes?: number;
    date: string;
    note?: string | null;
    startedAt?: string | null;
    endedAt?: string | null;
  };
  submitLabel: string;
  onSubmit: (values: TimeEntryValues) => void;
  onCancel: () => void;
};

function timeOf(instant: string | null | undefined): string {
  if (!instant) return '';
  const moment = new Date(instant);
  return `${String(moment.getHours()).padStart(2, '0')}:${String(moment.getMinutes()).padStart(2, '0')}`;
}

/** The instant of a `HH:mm` time on a `YYYY-MM-DD` day, on this device. */
function instantOn(day: string, time: string): string {
  return new Date(`${day}T${time}`).toISOString();
}

/** A full entry: length, day, optional start and end, and a note. */
export function EntryForm(props: EntryFormProps): JSX.Element {
  const [length, setLength] = createSignal(
    props.initial.minutes ? formatLength(props.initial.minutes) : ''
  );
  const [date, setDate] = createSignal(props.initial.date);
  const [start, setStart] = createSignal(timeOf(props.initial.startedAt));
  const [end, setEnd] = createSignal(timeOf(props.initial.endedAt));
  const [note, setNote] = createSignal(props.initial.note ?? '');

  const parsed = () => parseLength(length());
  // A span left as it was keeps its exact instants: the fields show whole
  // minutes, so a timer entry under a minute reads as the same start and end.
  const spanKept = () =>
    date() === props.initial.date &&
    start() === timeOf(props.initial.startedAt) &&
    end() === timeOf(props.initial.endedAt);
  const spanComplete = () => (start() === '') === (end() === '');
  const spanOrdered = () => start() === '' || spanKept() || end() > start();
  const valid = () =>
    parsed().kind === 'length' &&
    date() !== '' &&
    spanComplete() &&
    spanOrdered();

  const span = (): { startedAt: string | null; endedAt: string | null } => {
    if (start() === '' || end() === '')
      return { startedAt: null, endedAt: null };
    if (spanKept()) {
      return {
        startedAt: props.initial.startedAt ?? null,
        endedAt: props.initial.endedAt ?? null,
      };
    }
    return {
      startedAt: instantOn(date(), start()),
      endedAt: instantOn(date(), end()),
    };
  };

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    const current = parsed();
    if (!valid() || current.kind !== 'length') return;
    props.onSubmit({
      date: date(),
      minutes: current.minutes,
      note: note().trim() === '' ? null : note().trim(),
      ...span(),
    });
  };

  return (
    <form class="flex flex-col gap-3 p-2" onSubmit={submit}>
      <label class="flex flex-col gap-1 text-xs text-ink-muted">
        {t('timeTracking.length')}
        <Input
          value={length()}
          onInput={(event) => setLength(event.currentTarget.value)}
          placeholder="1h 30m"
          size="sm"
        />
        <Show when={parsed().kind === 'too-long'}>
          <span>
            {t('timeTracking.tooLong', { hours: MAX_ENTRY_MINUTES / 60 })}
          </span>
        </Show>
      </label>
      <label class="flex flex-col gap-1 text-xs text-ink-muted">
        {t('timeTracking.day')}
        <Input
          type="date"
          value={date()}
          onInput={(event) => setDate(event.currentTarget.value)}
          size="sm"
        />
      </label>
      <div class="grid grid-cols-2 gap-2">
        <label class="flex flex-col gap-1 text-xs text-ink-muted">
          {t('timeTracking.start')}
          <Input
            type="time"
            value={start()}
            onInput={(event) => setStart(event.currentTarget.value)}
            size="sm"
          />
        </label>
        <label class="flex flex-col gap-1 text-xs text-ink-muted">
          {t('timeTracking.end')}
          <Input
            type="time"
            value={end()}
            onInput={(event) => setEnd(event.currentTarget.value)}
            size="sm"
          />
        </label>
      </div>
      <label class="flex flex-col gap-1 text-xs text-ink-muted">
        {t('timeTracking.note')}
        <Input
          value={note()}
          onInput={(event) => setNote(event.currentTarget.value)}
          placeholder={t('timeTracking.notePlaceholder')}
          maxLength={2000}
          size="sm"
        />
      </label>
      <div class="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => props.onCancel()}
        >
          {t('timeTracking.cancel')}
        </Button>
        <Button type="submit" variant="primary" size="sm" disabled={!valid()}>
          {props.submitLabel}
        </Button>
      </div>
    </form>
  );
}
