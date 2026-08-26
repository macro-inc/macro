import type {
  EventEditorCalendarOption,
  EventEditorInitialValues,
} from '@app/features/calendar/components/composer/event-form-model';
import {
  type CalendarEvent,
  type CalendarPeriodView,
  DEFAULT_CALENDAR_SOURCE,
} from '@app/features/calendar/types';
import {
  formatLocalDate,
  parseLocalDate,
} from '@app/features/calendar/utils/calendar-date';
import {
  parseRecurrenceConfig,
  parseRecurrenceLines,
  type RecurrenceConfig,
  WEEKDAY_CODES,
} from '@app/features/calendar/utils/recurrence';
import { TZDateMini } from '@date-fns/tz';
import type { EventTime } from '@service-email/generated/schemas/eventTime';

interface CalendarToolPreviewEventInput {
  id: string;
  values: EventEditorInitialValues;
  time: EventTime | undefined;
  recurrenceLines: string[] | undefined;
  calendar: EventEditorCalendarOption | undefined;
  timeZone?: string;
}

/** Projects editable calendar-tool values into one query-free preview event. */
export function buildCalendarToolPreviewEvent(
  input: CalendarToolPreviewEventInput
): CalendarEvent | undefined {
  if (!input.time) return undefined;

  const calendar = input.calendar
    ? {
        id: input.calendar.id,
        name: input.calendar.label,
        color: input.calendar.color,
      }
    : DEFAULT_CALENDAR_SOURCE;
  const range =
    input.time.kind === 'timed'
      ? {
          allDay: false,
          start: input.time.startsAt,
          end: input.time.endsAt,
          timeZone: input.timeZone ?? input.time.timeZone ?? undefined,
        }
      : {
          allDay: true,
          start: input.time.startDate,
          end: input.time.endDate,
          timeZone: undefined,
        };

  return {
    ...range,
    // FullCalendar only reapplies the event color when an event remounts.
    id: JSON.stringify([input.id, calendar.id, calendar.color]),
    eventId: input.id,
    occurrenceKey: input.id,
    isCancelled: false,
    isReadOnly: true,
    attendees: [],
    recurrenceLines: input.recurrenceLines ?? input.values.recurrenceLines,
    calendarId: input.calendar?.id ?? input.values.calendarId,
    title: input.values.title.trim() || 'New event',
    calendar,
    location: input.values.location || undefined,
    description: input.values.description || undefined,
  };
}

/** Parses a preview start without shifting local all-day values. */
export function calendarToolPreviewStartDate(start: string, allDay: boolean) {
  const date = allDay ? parseLocalDate(start) : new Date(start);
  return date && !Number.isNaN(date.getTime()) ? date : undefined;
}

/** Returns the preview's local display date without shifting all-day values. */
export function calendarToolPreviewDate(event: CalendarEvent) {
  return calendarToolPreviewStartDate(event.start, event.allDay);
}

/** Visible period selected for a calendar-tool preview. */
export interface CalendarToolPreviewWindow {
  view: CalendarPeriodView;
  start: Date;
  end: Date;
  /** Consecutive days shown when previewing one non-recurring multi-day event. */
  dayCount?: number;
}

function calendarDate(
  year: number,
  month: number,
  day: number,
  hours = 0,
  minutes = 0,
  seconds = 0,
  milliseconds = 0,
  timeZone?: string
) {
  return timeZone
    ? new TZDateMini(
        year,
        month,
        day,
        hours,
        minutes,
        seconds,
        milliseconds,
        timeZone
      )
    : new Date(year, month, day, hours, minutes, seconds, milliseconds);
}

function startOfLocalDay(date: Date, timeZone?: string) {
  return calendarDate(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    0,
    0,
    0,
    0,
    timeZone
  );
}

function addLocalDays(date: Date, days: number, timeZone?: string) {
  return calendarDate(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + days,
    0,
    0,
    0,
    0,
    timeZone
  );
}

function localDayNumber(date: Date) {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
}

function occupiedEndDate(event: CalendarEvent) {
  const end = calendarToolPreviewStartDate(event.end, event.allDay);
  return end ? new Date(end.getTime() - 1) : undefined;
}

/** Chooses a bounded day, week, or month window for a proposed event. */
export function calendarToolPreviewWindow(
  event: CalendarEvent
): CalendarToolPreviewWindow | undefined {
  const start = calendarToolPreviewDate(event);
  const occupiedEnd = occupiedEndDate(event);
  if (!start || !occupiedEnd) return undefined;

  const recurrenceFrequency = parseRecurrenceLines(event.recurrenceLines).rule
    ?.frequency;
  const daySpan = Math.floor(
    (localDayNumber(occupiedEnd) - localDayNumber(start)) /
      (24 * 60 * 60 * 1000)
  );
  const view: CalendarPeriodView = recurrenceFrequency
    ? recurrenceFrequency === 'DAILY' || recurrenceFrequency === 'WEEKLY'
      ? 'timeGridWeek'
      : 'dayGridMonth'
    : event.recurrenceLines.length > 0 || daySpan >= 7
      ? 'dayGridMonth'
      : daySpan > 0
        ? 'timeGridWeek'
        : 'timeGridDay';

  if (view === 'dayGridMonth') {
    const monthStart = new Date(start.getFullYear(), start.getMonth(), 1);
    const monthEnd = new Date(start.getFullYear(), start.getMonth() + 1, 0);
    return {
      view,
      start: addLocalDays(monthStart, -monthStart.getDay()),
      end: addLocalDays(monthEnd, 7 - monthEnd.getDay()),
    };
  }
  if (view === 'timeGridWeek') {
    if (!recurrenceFrequency && daySpan > 0) {
      const rangeStart = startOfLocalDay(start);
      const dayCount = daySpan + 1;
      return {
        view,
        start: rangeStart,
        end: addLocalDays(rangeStart, dayCount),
        dayCount,
      };
    }
    const weekStart = addLocalDays(startOfLocalDay(start), -start.getDay());
    return { view, start: weekStart, end: addLocalDays(weekStart, 7) };
  }

  const dayStart = startOfLocalDay(start);
  return { view, start: dayStart, end: addLocalDays(dayStart, 1) };
}

function sameLocalDay(first: Date, second: Date) {
  return formatLocalDate(first) === formatLocalDate(second);
}

function monthDifference(first: Date, second: Date) {
  return (
    (second.getFullYear() - first.getFullYear()) * 12 +
    second.getMonth() -
    first.getMonth()
  );
}

function isMonthlyWeekday(
  date: Date,
  monthlyByDay: NonNullable<RecurrenceConfig['monthlyByDay']>,
  timeZone?: string
) {
  const weekday = WEEKDAY_CODES[date.getDay()];
  if (weekday !== monthlyByDay.weekday) return false;
  if (monthlyByDay.ordinal < 0) {
    const daysFromEnd =
      calendarDate(
        date.getFullYear(),
        date.getMonth() + 1,
        0,
        0,
        0,
        0,
        0,
        timeZone
      ).getDate() - date.getDate();
    return -(Math.floor(daysFromEnd / 7) + 1) === monthlyByDay.ordinal;
  }
  return Math.ceil(date.getDate() / 7) === monthlyByDay.ordinal;
}

function recurrenceMatches(
  date: Date,
  start: Date,
  config: RecurrenceConfig,
  weekStartsOn: number,
  timeZone?: string
) {
  if (sameLocalDay(date, start)) return true;
  const dayDifference = Math.floor(
    (localDayNumber(date) - localDayNumber(start)) / (24 * 60 * 60 * 1000)
  );

  if (config.frequency === 'DAILY') {
    return dayDifference % config.interval === 0;
  }
  if (config.frequency === 'WEEKLY') {
    const startOffset = (start.getDay() - weekStartsOn + 7) % 7;
    const dateOffset = (date.getDay() - weekStartsOn + 7) % 7;
    const startWeek = addLocalDays(
      startOfLocalDay(start, timeZone),
      -startOffset,
      timeZone
    );
    const dateWeek = addLocalDays(
      startOfLocalDay(date, timeZone),
      -dateOffset,
      timeZone
    );
    const weekDifference = Math.floor(
      (localDayNumber(dateWeek) - localDayNumber(startWeek)) /
        (7 * 24 * 60 * 60 * 1000)
    );
    const weekdays =
      config.byDay.length > 0 ? config.byDay : [WEEKDAY_CODES[start.getDay()]];
    return (
      weekDifference % config.interval === 0 &&
      weekdays.includes(WEEKDAY_CODES[date.getDay()])
    );
  }
  if (config.frequency === 'MONTHLY') {
    const months = monthDifference(start, date);
    if (months % config.interval !== 0) return false;
    return config.monthlyByDay
      ? isMonthlyWeekday(date, config.monthlyByDay, timeZone)
      : date.getDate() === start.getDate();
  }

  return (
    (date.getFullYear() - start.getFullYear()) % config.interval === 0 &&
    date.getMonth() === start.getMonth() &&
    date.getDate() === start.getDate()
  );
}

function recurrenceRuleField(rule: string, name: string) {
  const fields = rule.slice(rule.indexOf(':') + 1).split(';');
  const prefix = `${name.toUpperCase()}=`;
  return fields
    .map((field) => field.trim())
    .find((field) => field.toUpperCase().startsWith(prefix))
    ?.slice(prefix.length);
}

function recurrenceWeekStartsOn(rule: string) {
  const code = recurrenceRuleField(rule, 'WKST')?.toUpperCase();
  const index = code
    ? WEEKDAY_CODES.indexOf(code as (typeof WEEKDAY_CODES)[number])
    : -1;
  return index >= 0 ? index : 1;
}

function recurrenceUntil(
  rule: string,
  allDay: boolean,
  timeZone?: string
): { date?: string; instant?: Date } | undefined {
  const value = recurrenceRuleField(rule, 'UNTIL');
  if (!value) return undefined;
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(
    value
  );
  if (!match) return undefined;
  if (allDay || match[4] === undefined) {
    return { date: `${match[1]}-${match[2]}-${match[3]}` };
  }

  const parts = match.slice(1, 7).map(Number);
  const [year, month, day, hours, minutes, seconds] = parts;
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hours === undefined ||
    minutes === undefined ||
    seconds === undefined
  ) {
    return undefined;
  }
  return {
    instant: match[7]
      ? new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds))
      : calendarDate(
          year,
          month - 1,
          day,
          hours,
          minutes,
          seconds,
          0,
          timeZone
        ),
  };
}

function occurrenceEvent(
  event: CalendarEvent,
  occurrenceStart: Date,
  duration: number,
  index: number
): CalendarEvent {
  const start = event.allDay
    ? formatLocalDate(occurrenceStart)
    : occurrenceStart.toISOString();
  const occurrenceEnd = event.allDay
    ? addLocalDays(occurrenceStart, duration)
    : new Date(occurrenceStart.getTime() + duration);
  const end = event.allDay
    ? formatLocalDate(occurrenceEnd)
    : occurrenceEnd.toISOString();

  return {
    ...event,
    id: JSON.stringify([event.id, start]),
    occurrenceKey: start,
    start,
    end,
    recurrenceId: `${event.eventId}:${index}`,
  };
}

/** Materializes proposed recurrence instances inside the selected preview. */
export function expandCalendarToolPreviewEvents(
  event: CalendarEvent,
  window: CalendarToolPreviewWindow,
  limit = 50
): CalendarEvent[] {
  const recurrenceRule = event.recurrenceLines.find((line) =>
    line.trimStart().toUpperCase().startsWith('RRULE:')
  );
  const config = parseRecurrenceConfig(event.recurrenceLines, event.timeZone);
  const displayStart = calendarToolPreviewDate(event);
  const end = calendarToolPreviewStartDate(event.end, event.allDay);
  const timeZone = event.allDay ? undefined : event.timeZone;
  const start =
    displayStart && timeZone
      ? TZDateMini.tz(timeZone, displayStart)
      : displayStart;
  if (!recurrenceRule || !config || !start || !end || limit <= 0) {
    return [event];
  }
  const weekStartsOn = recurrenceWeekStartsOn(recurrenceRule);
  const until = recurrenceUntil(recurrenceRule, event.allDay, timeZone);

  const duration = event.allDay
    ? Math.max(
        1,
        Math.round(
          (localDayNumber(end) - localDayNumber(start)) / (24 * 60 * 60 * 1000)
        )
      )
    : end.getTime() - start.getTime();
  if (duration <= 0) return [event];

  const occurrences: CalendarEvent[] = [];
  let cursor = startOfLocalDay(start, timeZone);
  let ruleOccurrenceIndex = 0;
  let renderedIndex = 0;
  let ruleEnded = false;
  const cursorEnd = new Date(window.end.getTime() + 24 * 60 * 60 * 1000);
  while (cursor < cursorEnd && occurrences.length < limit) {
    const date = formatLocalDate(cursor);
    const occurrenceStart = event.allDay
      ? cursor
      : calendarDate(
          cursor.getFullYear(),
          cursor.getMonth(),
          cursor.getDate(),
          start.getHours(),
          start.getMinutes(),
          start.getSeconds(),
          start.getMilliseconds(),
          timeZone
        );
    let matchesRule =
      !ruleEnded &&
      recurrenceMatches(cursor, start, config, weekStartsOn, timeZone);
    if (matchesRule) {
      ruleOccurrenceIndex += 1;
      const exceedsCount =
        config.ends.kind === 'after' && ruleOccurrenceIndex > config.ends.count;
      const exceedsDateUntil =
        (until?.date !== undefined && date > until.date) ||
        (until === undefined &&
          config.ends.kind === 'on' &&
          date > config.ends.date);
      const exceedsInstantUntil =
        until?.instant !== undefined && occurrenceStart > until.instant;
      if (exceedsCount || exceedsDateUntil || exceedsInstantUntil) {
        matchesRule = false;
        ruleEnded = true;
      }
    }

    if (matchesRule) {
      const occurrenceEnd = event.allDay
        ? addLocalDays(occurrenceStart, duration)
        : new Date(occurrenceStart.getTime() + duration);
      if (occurrenceStart < window.end && occurrenceEnd > window.start) {
        renderedIndex += 1;
        occurrences.push(
          occurrenceEvent(event, occurrenceStart, duration, renderedIndex)
        );
      }
    }
    cursor = addLocalDays(cursor, 1, timeZone);
  }

  return occurrences.length > 0 ? occurrences : [event];
}
