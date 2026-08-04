import CalendarIcon from '@phosphor/calendar-blank.svg';
import ClockIcon from '@phosphor/clock.svg';
import MapPinIcon from '@phosphor/map-pin.svg';
import { Show } from 'solid-js';
import { formatCalendarTime } from '../time-format';
import type { CalendarEvent, CalendarTimeFormat } from './types';

const formatDate = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'long',
  day: 'numeric',
});
const formatShortDate = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
});
const isDateOnly = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

function parseCalendarDate(value: string) {
  if (!isDateOnly(value)) return new Date(value);

  const [year, month, day] = value.split('-').map(Number);
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1);
}

const isSameLocalDate = (first: Date, second: Date) =>
  first.getFullYear() === second.getFullYear() &&
  first.getMonth() === second.getMonth() &&
  first.getDate() === second.getDate();

function formatEventSchedule(
  event: CalendarEvent,
  timeFormat: CalendarTimeFormat
) {
  const start = parseCalendarDate(event.start);
  const end = parseCalendarDate(event.end);

  if (event.allDay) {
    const inclusiveEnd = new Date(end);
    inclusiveEnd.setDate(inclusiveEnd.getDate() - 1);
    return isSameLocalDate(start, inclusiveEnd)
      ? `${formatDate.format(start)} · All day`
      : `${formatShortDate.format(start)}–${formatShortDate.format(inclusiveEnd)} · All day`;
  }

  return isSameLocalDate(start, end)
    ? `${formatDate.format(start)} · ${formatCalendarTime(start, timeFormat)}–${formatCalendarTime(end, timeFormat)}`
    : `${formatDate.format(start)}, ${formatCalendarTime(start, timeFormat)}–${formatDate.format(end)}, ${formatCalendarTime(end, timeFormat)}`;
}

/** Displays read-only details for a selected calendar event. */
export function EventDetails(props: {
  event: CalendarEvent;
  timeFormat: CalendarTimeFormat;
}) {
  return (
    <div class="min-w-0 p-1 text-ink">
      <div class="flex items-start gap-2">
        <div
          aria-hidden="true"
          class="mt-1 size-2.5 shrink-0 rounded-sm"
          style={{ 'background-color': props.event.calendar.color }}
        />
        <div class="min-w-0 flex-1">
          <div class="text-sm font-semibold leading-snug text-ink">
            {props.event.title}
          </div>
          <div class="mt-2 flex flex-col gap-2 text-xs text-ink-muted">
            <div class="flex items-start gap-2">
              <Show
                when={props.event.allDay}
                fallback={
                  <ClockIcon class="mt-0.5 size-3.5 shrink-0 text-ink-extra-muted" />
                }
              >
                <CalendarIcon class="mt-0.5 size-3.5 shrink-0 text-ink-extra-muted" />
              </Show>
              <span>{formatEventSchedule(props.event, props.timeFormat)}</span>
            </div>
            <Show when={props.event.location}>
              {(location) => (
                <div class="flex items-start gap-2">
                  <MapPinIcon class="mt-0.5 size-3.5 shrink-0 text-ink-extra-muted" />
                  <span>{location()}</span>
                </div>
              )}
            </Show>
            <div class="flex items-center gap-2">
              <span
                aria-hidden="true"
                class="size-2 shrink-0 rounded-sm"
                style={{ 'background-color': props.event.calendar.color }}
              />
              <span>{props.event.calendar.name}</span>
            </div>
          </div>
          <Show when={props.event.description}>
            {(description) => (
              <p class="mt-3 border-t border-edge-muted pt-3 text-xs leading-relaxed text-ink-muted">
                {description()}
              </p>
            )}
          </Show>
        </div>
      </div>
    </div>
  );
}
