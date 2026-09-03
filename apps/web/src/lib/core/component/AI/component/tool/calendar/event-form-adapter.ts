import type {
  EventEditorInitialValues,
  EventEditorSubmitValues,
} from '@app/features/calendar/components/composer/event-form-model';
import type {
  CreateCalendarEvent,
  EventTimeInput,
} from '@service-cognition/generated/tools/types';
import { format, isValid, parseISO, subDays } from 'date-fns';
import { match } from 'ts-pattern';

/**
 * The consequential side effects of a deferred out-of-office create, so the
 * confirmation composer can disclose them before the user confirms. EventForm
 * does not surface `eventType`/`outOfOffice`, so without this an event that
 * looks ordinary would silently write an away block and auto-decline meetings.
 */
export type OutOfOfficeNotice = {
  /** Plain-language description of the away status and auto-decline behavior. */
  effect: string;
  /** The reply sent to auto-declined organizers, when one is set. */
  declineMessage?: string;
};

/** Describe a deferred create's out-of-office effects, or `undefined` when it is a regular event. */
export function outOfOfficeNotice(
  event: CreateCalendarEvent
): OutOfOfficeNotice | undefined {
  if (event.eventType !== 'out_of_office') return undefined;
  const effect = match(event.outOfOffice?.autoDeclineMode ?? 'decline_none')
    .with(
      'decline_all',
      () =>
        'Google will show you as away and automatically decline all conflicting invitations.'
    )
    .with(
      'decline_new_only',
      () =>
        'Google will show you as away and automatically decline newly received conflicting invitations.'
    )
    .otherwise(
      () =>
        'Google will show you as away for this time; conflicting invitations are left untouched.'
    );
  const declineMessage = event.outOfOffice?.declineMessage?.trim() || undefined;
  return { effect, declineMessage };
}

const DATE_VALUE = 'yyyy-MM-dd';
const DATETIME_VALUE = "yyyy-MM-dd'T'HH:mm";

function formatLocalInstant(value: string) {
  const instant = new Date(value);
  return isValid(instant) ? format(instant, DATETIME_VALUE) : '';
}

function inclusiveAllDayEnd(exclusiveEnd: string) {
  const end = parseISO(exclusiveEnd);
  return isValid(end) ? format(subDays(end, 1), DATE_VALUE) : exclusiveEnd;
}

function cloneReminders(
  reminders: CreateCalendarEvent['reminders']
): EventEditorInitialValues['reminders'] {
  if (!reminders) return undefined;
  return {
    useDefault: reminders.useDefault,
    overrides: reminders.overrides?.map((reminder) => ({ ...reminder })),
  };
}

/** Convert deferred calendar-tool arguments into values understood by EventForm. */
export function createCalendarEventToEditorInitialValues(
  event: CreateCalendarEvent
): EventEditorInitialValues {
  const common = {
    title: event.title,
    recurrenceLines: [...(event.recurrenceLines ?? [])],
    calendarId: event.calendarId ?? undefined,
    guests: (event.attendees ?? [])
      .map((attendee) => attendee.email)
      .join(', '),
    location: event.location ?? '',
    description: event.description ?? '',
    conference: event.addGoogleMeet
      ? ('google_meet' as const)
      : ('none' as const),
    reminders: cloneReminders(event.reminders),
  };

  if (event.time.kind === 'allDay') {
    return {
      ...common,
      allDay: true,
      start: event.time.startDate,
      end: inclusiveAllDayEnd(event.time.endDate),
    };
  }

  return {
    ...common,
    allDay: false,
    start: formatLocalInstant(event.time.startsAt),
    end: formatLocalInstant(event.time.endsAt),
  };
}

function toolTime(
  time: EventEditorSubmitValues['time'],
  original: EventTimeInput
): EventTimeInput {
  if (time.kind === 'allDay') {
    return {
      kind: 'allDay',
      startDate: time.startDate,
      endDate: time.endDate,
    };
  }

  return {
    kind: 'timed',
    startsAt: time.startsAt,
    endsAt: time.endsAt,
    timeZone:
      original.kind === 'timed'
        ? (original.timeZone ?? time.timeZone)
        : time.timeZone,
  };
}

function attendees(
  emails: string[],
  original: CreateCalendarEvent['attendees']
): NonNullable<CreateCalendarEvent['attendees']> {
  const existing = new Map(
    (original ?? []).map((attendee) => [
      attendee.email.trim().toLowerCase(),
      attendee,
    ])
  );

  return emails.map((email) => {
    const previous = existing.get(email.trim().toLowerCase());
    return previous?.isOptional === undefined
      ? { email }
      : { email, isOptional: previous.isOptional };
  });
}

/** Merge editable EventForm values back into the deferred tool arguments. */
export function editorSubmitValuesToCreateCalendarEvent(
  values: EventEditorSubmitValues,
  original: CreateCalendarEvent
): CreateCalendarEvent {
  return {
    ...original,
    title: values.title,
    time: toolTime(values.time, original.time),
    description: values.description || undefined,
    location: values.location || undefined,
    attendees: attendees(values.guestEmails, original.attendees),
    recurrenceLines: values.recurrenceLines ?? original.recurrenceLines ?? [],
    calendarId: values.calendarId,
    addGoogleMeet:
      values.conference === undefined
        ? original.addGoogleMeet
        : values.conference === 'google_meet',
    reminders: cloneReminders(values.reminders ?? original.reminders),
  };
}
