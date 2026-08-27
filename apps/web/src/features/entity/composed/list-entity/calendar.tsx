import RepeatIcon from '@phosphor/repeat.svg';
import { Show } from 'solid-js';
import type {
  CalendarEventEntity,
  CalendarEventEntityTime,
} from '../../types/entity';

const dateWithYear = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});
const dateNoYear = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});
const timeOnly = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
});

function dateLabel(date: Date): string {
  const formatter =
    date.getFullYear() === new Date().getFullYear() ? dateNoYear : dateWithYear;
  return formatter.format(date);
}

/** Parse an all-day `YYYY-MM-DD` key as a local date, no UTC shift. */
function parseAllDay(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3])
  );
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** When the row's resolved occurrence happens, at the row's density. */
function formatWhen(time: CalendarEventEntityTime | undefined): string {
  if (!time) return '';
  if (time.kind === 'allDay') {
    const date = parseAllDay(time.startDate);
    return date ? dateLabel(date) : '';
  }
  const start = new Date(time.startsAt);
  if (Number.isNaN(start.getTime())) return '';
  return `${dateLabel(start)} · ${timeOnly.format(start)}`;
}

/**
 * Trailing summary for a calendar event row in the mixed search list: the
 * resolved occurrence's date/time, with a recurrence glyph when the event
 * repeats — enough to tell one hit from another at a glance.
 */
export function CalendarEventWhen(props: { entity: CalendarEventEntity }) {
  const when = () => formatWhen(props.entity.time);
  return (
    <span class="inline-flex items-center gap-1 whitespace-nowrap text-xs text-ink-extra-muted font-normal">
      <Show when={props.entity.isRecurring}>
        <RepeatIcon class="size-3 shrink-0" aria-label="Repeats" />
      </Show>
      <span>{when()}</span>
    </span>
  );
}
