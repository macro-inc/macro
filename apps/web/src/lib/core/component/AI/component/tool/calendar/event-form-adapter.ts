import type {
  EventEditorInitialValues,
  EventEditorSubmitValues,
} from '@app/features/calendar/components/composer/event-form-model';
import type { EventEditorOutOfOffice } from '@app/features/calendar/components/composer/out-of-office';
import type {
  AutoDeclineModeInput,
  CreateCalendarEvent,
  EventTimeInput,
} from '@service-cognition/generated/tools/types';
import { format, isValid, parseISO, subDays } from 'date-fns';

/** The calendar tools abbreviate the email service's decline mode names. */
const TOOL_TO_EDITOR_DECLINE_MODE: Record<
  AutoDeclineModeInput,
  EventEditorOutOfOffice['autoDeclineMode']
> = {
  decline_none: 'decline_none',
  decline_all: 'decline_all_conflicting_invitations',
  decline_new_only: 'decline_only_new_conflicting_invitations',
};

const EDITOR_TO_TOOL_DECLINE_MODE: Record<
  EventEditorOutOfOffice['autoDeclineMode'],
  AutoDeclineModeInput
> = {
  decline_none: 'decline_none',
  decline_all_conflicting_invitations: 'decline_all',
  decline_only_new_conflicting_invitations: 'decline_new_only',
};

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
  const isOutOfOffice = event.eventType === 'out_of_office';
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
    eventType: isOutOfOffice ? ('out_of_office' as const) : undefined,
    outOfOffice: isOutOfOffice
      ? {
          autoDeclineMode:
            TOOL_TO_EDITOR_DECLINE_MODE[
              event.outOfOffice?.autoDeclineMode ?? 'decline_none'
            ],
          declineMessage: event.outOfOffice?.declineMessage ?? '',
        }
      : undefined,
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
  // A create's submit values carry `outOfOffice` exactly while the editor kind
  // is out of office, so its presence decides the tool's event type.
  const outOfOffice = values.outOfOffice;
  return {
    ...original,
    title: values.title,
    time: toolTime(values.time, original.time),
    description: values.description || undefined,
    location: values.location || undefined,
    attendees: attendees(values.guestEmails, original.attendees),
    recurrenceLines: values.recurrenceLines ?? original.recurrenceLines ?? [],
    calendarId: values.calendarId,
    addGoogleMeet: outOfOffice
      ? false
      : values.conference === undefined
        ? original.addGoogleMeet
        : values.conference === 'google_meet',
    reminders: cloneReminders(values.reminders ?? original.reminders),
    eventType: outOfOffice
      ? 'out_of_office'
      : original.eventType === 'out_of_office'
        ? 'default'
        : original.eventType,
    outOfOffice: outOfOffice
      ? {
          autoDeclineMode:
            EDITOR_TO_TOOL_DECLINE_MODE[
              outOfOffice.autoDeclineMode ?? 'decline_none'
            ],
          ...(outOfOffice.declineMessage
            ? { declineMessage: outOfOffice.declineMessage }
            : {}),
        }
      : undefined,
  };
}
