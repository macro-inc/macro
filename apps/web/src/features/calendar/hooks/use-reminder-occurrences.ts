import { canMoveReminderFiring } from '@app/features/reminders/reminder-schedule';
import type { CalendarOccurrenceQueryRange } from '@queries/calendar/occurrences';
import { useReminderOccurrencesQuery } from '@queries/reminders/occurrences';
import type { ReminderOccurrence } from '@service-storage/generated/schemas/reminderOccurrence';
import { type Accessor, createMemo } from 'solid-js';
import type { CalendarEvent, CalendarSource } from '../types';
import { isCalendarRangeSupported } from '../utils/calendar-supported-range';
import { useCalendarRemindersFlag } from './use-calendar-ui-flag';

/** Visibility-source id gating the reminders overlay. */
export const REMINDERS_SOURCE_ID = 'reminders';

/**
 * How long a reminder chip spans on the grid. A reminder fires at an instant;
 * this only gives the chip room to render, short enough to stay on one line.
 */
const REMINDER_CHIP_DURATION_MS = 15 * 60 * 1000;

/** The widest window the occurrences endpoint accepts. */
const MAX_REMINDER_WINDOW_MS = 62 * 24 * 60 * 60 * 1000;

const REMINDERS_SOURCE: CalendarSource = {
  id: REMINDERS_SOURCE_ID,
  name: 'Reminders',
  color: 'var(--color-reminder)',
};

/** The rendered id of one firing, distinct from every calendar event id. */
function reminderOccurrenceId(occurrence: ReminderOccurrence) {
  return JSON.stringify([
    'reminder',
    occurrence.reminderId,
    occurrence.scheduledFor,
  ]);
}

function mapReminderOccurrence(occurrence: ReminderOccurrence): CalendarEvent {
  const start = new Date(occurrence.scheduledFor);
  const end = new Date(start.getTime() + REMINDER_CHIP_DURATION_MS);

  return {
    id: reminderOccurrenceId(occurrence),
    eventId: occurrence.reminderId,
    occurrenceKey: occurrence.scheduledFor,
    reminderId: occurrence.reminderId,
    isCancelled: false,
    isReadOnly: !canMoveReminderFiring(occurrence.schedule),
    attendees: [],
    recurrenceLines: [],
    sourceCalendarIds: [REMINDERS_SOURCE_ID],
    title: occurrence.description,
    start: start.toISOString(),
    end: end.toISOString(),
    allDay: false,
    calendar: REMINDERS_SOURCE,
    visibleCalendars: [REMINDERS_SOURCE],
  };
}

export interface ReminderEventData {
  events: Accessor<CalendarEvent[]>;
  visibleEvents: Accessor<CalendarEvent[]>;
  eventsById: Accessor<Map<string, CalendarEvent>>;
  /** The firing each chip stands for, keyed by the chip's event id. */
  occurrencesById: Accessor<Map<string, ReminderOccurrence>>;
}

export interface ReminderEventOptions {
  range: Accessor<CalendarOccurrenceQueryRange | undefined>;
  isSourceVisible?: (sourceId: string) => boolean;
  refetchOnWindowFocus?: Accessor<boolean>;
}

/**
 * The caller's standalone reminders, overlaid on the calendar as chips that
 * move but do not resize. Reminders about an entity already surface with that
 * entity, so only ones attached to nothing appear here.
 */
export function useReminderEvents(
  options: ReminderEventOptions
): ReminderEventData {
  const remindersEnabled = useCalendarRemindersFlag();
  const occurrenceWindow = createMemo(() => {
    const range = options.range();
    if (!range || !isCalendarRangeSupported(range)) return undefined;
    const span =
      new Date(range.end).getTime() - new Date(range.start).getTime();
    if (span <= 0 || span > MAX_REMINDER_WINDOW_MS) return undefined;
    return { start: range.start, end: range.end, attached: false };
  });
  const isOverlayVisible = () =>
    remindersEnabled() &&
    options.isSourceVisible?.(REMINDERS_SOURCE_ID) !== false;
  const query = useReminderOccurrencesQuery(occurrenceWindow, () => ({
    enabled: isOverlayVisible(),
    refetchOnWindowFocus: options.refetchOnWindowFocus?.(),
  }));
  const occurrences = createMemo(() => {
    // Read data only on success: a failed overlay fetch degrades to no chips,
    // and gating keeps this off the pending resource read that suspends.
    if (!remindersEnabled() || !occurrenceWindow() || !query.isSuccess) {
      return [];
    }
    return query.data;
  });
  const events = createMemo(() => occurrences().map(mapReminderOccurrence));
  const visibleEvents = createMemo(() => (isOverlayVisible() ? events() : []));
  const eventsById = createMemo(
    () => new Map(events().map((event) => [event.id, event]))
  );
  const occurrencesById = createMemo(
    () =>
      new Map(
        occurrences().map((occurrence) => [
          reminderOccurrenceId(occurrence),
          occurrence,
        ])
      )
  );

  return { events, visibleEvents, eventsById, occurrencesById };
}
