import type { VisibleCalendar } from '@service-calendar/generated/schemas/visibleCalendar';
import type { AttendeeResponseStatus } from '@service-storage/generated/schemas/attendeeResponseStatus';
import type { CalendarAttendee } from '@service-storage/generated/schemas/calendarAttendee';
import type { CalendarEvent } from '@service-storage/generated/schemas/calendarEvent';
import type { CalendarOccurrenceItem } from '@service-storage/generated/schemas/calendarOccurrenceItem';
import type { CalendarSyncStatus } from '@service-storage/generated/schemas/calendarSyncStatus';
import type { ConferenceProvider } from '@service-storage/generated/schemas/conferenceProvider';
import type { EventReminders } from '@service-storage/generated/schemas/eventReminders';
import type { EventStatus } from '@service-storage/generated/schemas/eventStatus';
import type { EventTime } from '@service-storage/generated/schemas/eventTime';
import type { EventTransparency } from '@service-storage/generated/schemas/eventTransparency';
import type { EventType } from '@service-storage/generated/schemas/eventType';
import type { EventVisibility } from '@service-storage/generated/schemas/eventVisibility';
import type {
  CalendarAttendeeFieldsFragment,
  CalendarEventFieldsFragment,
  CalendarEventTimeFieldsFragment,
  CalendarFieldsFragment,
  CalendarOccurrenceItemFieldsFragment,
  CalendarReminderFieldsFragment,
} from '@service-storage/graphql/generated/graphql';

/** GraphQL enums are the SCREAMING_CASE spelling of the REST snake_case values. */
const restEnum = <T extends string>(value: string): T =>
  value.toLowerCase() as T;

/** RFC 3339 instants in the REST spelling, which writes UTC as `Z`. */
const restInstant = (value: string): string =>
  value.endsWith('+00:00') ? `${value.slice(0, -'+00:00'.length)}Z` : value;

export function mapCalendarSyncStatus(status: string): CalendarSyncStatus {
  return restEnum<CalendarSyncStatus>(status);
}

function mapEventTime(time: CalendarEventTimeFieldsFragment): EventTime {
  return time.__typename === 'GraphqlTimedEventTime'
    ? {
        kind: 'timed',
        startsAt: restInstant(time.startsAt),
        endsAt: restInstant(time.endsAt),
        timeZone: time.timeZone,
      }
    : { kind: 'allDay', startDate: time.startDate, endDate: time.endDate };
}

function mapAttendee(
  attendee: CalendarAttendeeFieldsFragment
): CalendarAttendee {
  return {
    email: attendee.email,
    displayName: attendee.displayName,
    responseStatus: restEnum<AttendeeResponseStatus>(attendee.responseStatus),
    isOrganizer: attendee.isOrganizer,
    isOptional: attendee.isOptional,
    isSelf: attendee.isSelf,
    comment: attendee.comment,
  };
}

function mapReminders(
  reminders: CalendarReminderFieldsFragment
): EventReminders {
  return {
    useDefault: reminders.useDefault,
    overrides: reminders.overrides.map(({ method, minutes }) => ({
      method,
      minutes,
    })),
  };
}

/** Maps the series event to the REST `CalendarEvent` shape. */
export function mapCalendarEvent(
  event: CalendarEventFieldsFragment
): CalendarEvent {
  return {
    id: event.id,
    ownerId: event.ownerId,
    icalUid: event.icalUid,
    calendarId: event.calendarId,
    sources: event.sources.map((source) => ({
      calendarId: source.calendarId,
      title: source.title,
      description: source.description,
      location: source.location,
      eventType: restEnum<EventType>(source.eventType),
      visibility: restEnum<EventVisibility>(source.visibility),
      transparency: restEnum<EventTransparency>(source.transparency),
      isReadOnly: source.isReadOnly,
      reminders: mapReminders(source.reminders),
      creatorEmail: source.creatorEmail,
      creatorName: source.creatorName,
    })),
    title: event.title,
    description: event.description,
    location: event.location,
    status: restEnum<EventStatus>(event.status),
    visibility: restEnum<EventVisibility>(event.visibility),
    transparency: restEnum<EventTransparency>(event.transparency),
    eventType: restEnum<EventType>(event.eventType),
    time: mapEventTime(event.time),
    recurrenceLines: event.recurrenceLines,
    organizerEmail: event.organizerEmail,
    organizerName: event.organizerName,
    creatorEmail: event.creatorEmail,
    creatorName: event.creatorName,
    conferenceUrl: event.conferenceUrl,
    conferenceProvider:
      event.conferenceProvider === null
        ? null
        : restEnum<ConferenceProvider>(event.conferenceProvider),
    sequence: event.sequence,
    isReadOnly: event.isReadOnly,
    attendees: event.attendees.map(mapAttendee),
    reminders: mapReminders(event.reminders),
    createdAt: restInstant(event.createdAt),
    updatedAt: restInstant(event.updatedAt),
  };
}

/**
 * Maps an occurrence to the REST item. Like the REST listing, `event` is the
 * series event with this occurrence's exception applied: an overridden
 * title, description, or location replaces the event's and every copy's,
 * an overridden status replaces the status, and instance attendees replace
 * the attendee list.
 */
export function mapCalendarOccurrence(
  occurrence: CalendarOccurrenceItemFieldsFragment
): CalendarOccurrenceItem {
  const event = mapCalendarEvent(occurrence.event);
  const { overrideTitle, overrideDescription, overrideLocation } = occurrence;
  if (overrideTitle !== null) event.title = overrideTitle;
  if (overrideDescription !== null) event.description = overrideDescription;
  if (overrideLocation !== null) event.location = overrideLocation;
  event.sources = event.sources?.map((source) => ({
    ...source,
    ...(overrideTitle !== null ? { title: overrideTitle } : {}),
    ...(overrideDescription !== null
      ? { description: overrideDescription }
      : {}),
    ...(overrideLocation !== null ? { location: overrideLocation } : {}),
  }));
  if (occurrence.overrideStatus !== null) {
    event.status = restEnum<EventStatus>(occurrence.overrideStatus);
  }
  if (occurrence.overrideAttendees !== null) {
    event.attendees = occurrence.overrideAttendees.map(mapAttendee);
  }
  return {
    event,
    occurrence: {
      eventId: occurrence.eventId,
      occurrenceKey: occurrence.occurrenceKey,
      recurrenceId: occurrence.recurrenceId,
      time: mapEventTime(occurrence.time),
      isCancelled: occurrence.isCancelled,
    },
  };
}

/** Maps a visible calendar to the REST `VisibleCalendar` shape. */
export function mapVisibleCalendar(
  calendar: CalendarFieldsFragment
): VisibleCalendar {
  return {
    id: calendar.id,
    emailLinkId: calendar.linkId,
    emailAddress: calendar.emailAddress,
    name: calendar.name,
    color: calendar.color,
    isPrimary: calendar.isPrimary,
    isWritable: calendar.isWritable,
    isSubscription: calendar.isSubscription,
    syncError: calendar.syncError,
    defaultReminders: calendar.defaultReminders.map(({ method, minutes }) => ({
      method,
      minutes,
    })),
  };
}
