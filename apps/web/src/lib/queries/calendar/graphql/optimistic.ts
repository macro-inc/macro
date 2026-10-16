import type { EventReminders } from '@service-storage/generated/schemas/eventReminders';
import type { EventTime } from '@service-storage/generated/schemas/eventTime';
import type {
  CalendarAttendeeFieldsFragment,
  CalendarEventFieldsFragment,
  CalendarEventTimeFieldsFragment,
  CalendarEventTimeInput,
  CalendarOccurrenceItemFieldsFragment,
  CalendarReminderFieldsFragment,
  GraphqlCalendarAttendeeResponseStatus,
} from '@service-storage/graphql/generated/graphql';

type EventRecord = CalendarEventFieldsFragment;
type OccurrenceRecord = CalendarOccurrenceItemFieldsFragment;
type SourceRecord = EventRecord['sources'][number];

/** GraphQL enums are the SCREAMING_CASE spelling of REST snake_case values. */
export const graphqlEnum = <T extends string>(value: string): T =>
  value.toUpperCase() as T;

/** RFC 3339 in the server's spelling, so client ids match server occurrence keys. */
export function serverInstant(value: string): string {
  return new Date(value).toISOString().replace(/(\.000)?Z$/, '+00:00');
}

export function graphqlTimeRecord(
  time: EventTime
): CalendarEventTimeFieldsFragment {
  return time.kind === 'timed'
    ? {
        __typename: 'GraphqlTimedEventTime',
        startsAt: serverInstant(time.startsAt),
        endsAt: serverInstant(time.endsAt),
        timeZone: time.timeZone ?? null,
      }
    : {
        __typename: 'GraphqlAllDayEventTime',
        startDate: time.startDate,
        endDate: time.endDate,
      };
}

export function graphqlTimeInput(time: EventTime): CalendarEventTimeInput {
  return time.kind === 'timed'
    ? {
        timed: {
          startsAt: time.startsAt,
          endsAt: time.endsAt,
          timeZone: time.timeZone ?? null,
        },
      }
    : { allDay: { startDate: time.startDate, endDate: time.endDate } };
}

/** The key the server derives for an occurrence from its start. */
export function occurrenceKeyOf(time: EventTime): string {
  return time.kind === 'timed' ? serverInstant(time.startsAt) : time.startDate;
}

export function graphqlReminders(
  reminders: EventReminders
): CalendarReminderFieldsFragment {
  return {
    useDefault: reminders.useDefault,
    overrides: (reminders.overrides ?? []).map(({ method, minutes }) => ({
      method,
      minutes,
    })),
  };
}

/** The attendee answering: the named address, else the viewer's own inbox. */
function isResponder(
  attendee: CalendarAttendeeFieldsFragment,
  respondingEmail: string | undefined
): boolean {
  return respondingEmail
    ? attendee.email.toLowerCase() === respondingEmail.toLowerCase()
    : attendee.isSelf;
}

/**
 * The attendee list with the responder's answer recorded, or `undefined`
 * when the responder is not on it.
 */
export function withRsvp(
  attendees: readonly CalendarAttendeeFieldsFragment[],
  respondingEmail: string | undefined,
  response: GraphqlCalendarAttendeeResponseStatus
): CalendarAttendeeFieldsFragment[] | undefined {
  const responder = attendees.find((attendee) =>
    isResponder(attendee, respondingEmail)
  );
  if (!responder) return undefined;
  return attendees.map((attendee) =>
    attendee === responder
      ? { ...attendee, responseStatus: response }
      : attendee
  );
}

export interface EventFieldPatch {
  title?: string | null;
  description?: string | null;
  location?: string | null;
  reminders?: EventReminders | null;
  time?: EventTime | null;
}

type CopyContent = Pick<
  SourceRecord,
  'title' | 'description' | 'location' | 'reminders'
>;

/** The per-copy fields a patch rewrites on one copy of the event. */
function patchCopy<T extends CopyContent>(copy: T, patch: EventFieldPatch): T {
  const next = { ...copy };
  if (patch.title !== undefined && patch.title !== null) {
    next.title = patch.title;
  }
  if (patch.description !== undefined) next.description = patch.description;
  if (patch.location !== undefined) next.location = patch.location;
  if (patch.reminders !== undefined && patch.reminders !== null) {
    next.reminders = graphqlReminders(patch.reminders);
  }
  return next;
}

/**
 * The event record after a whole-event patch. Per-copy fields land on the
 * addressed copy, the named calendar's or else the canonical (first) one,
 * and on the entity when that copy is canonical, mirroring how the server
 * records them.
 */
export function patchedEvent(
  event: EventRecord,
  patch: EventFieldPatch,
  calendarId: string | undefined
): EventRecord {
  const target = calendarId ?? event.sources[0]?.calendarId;
  const patchesCanonical =
    event.sources.length === 0 || target === event.sources[0]?.calendarId;
  const next = patchesCanonical ? patchCopy(event, patch) : { ...event };
  next.sources = event.sources.map((copy) =>
    copy.calendarId === target ? patchCopy(copy, patch) : copy
  );
  if (patch.time) next.time = graphqlTimeRecord(patch.time);
  return next;
}

/** Recurring expansion is the provider's: only standalone instances move. */
export function isStandalone(
  event: Pick<EventRecord, 'recurrenceLines'>,
  occurrence: Pick<OccurrenceRecord, 'recurrenceId'>
): boolean {
  return event.recurrenceLines.length === 0 && occurrence.recurrenceId === null;
}

/** One occurrence's record after a patch scoped to it alone. */
export function patchedOccurrence(
  occurrence: OccurrenceRecord,
  patch: EventFieldPatch
): Partial<OccurrenceRecord> & Pick<OccurrenceRecord, '__typename' | 'id'> {
  return {
    __typename: occurrence.__typename,
    id: occurrence.id,
    ...(patch.title !== undefined && patch.title !== null
      ? { overrideTitle: patch.title }
      : {}),
    ...(patch.description !== undefined
      ? { overrideDescription: patch.description }
      : {}),
    ...(patch.location !== undefined
      ? { overrideLocation: patch.location }
      : {}),
    ...(patch.time ? { time: graphqlTimeRecord(patch.time) } : {}),
  };
}

/** The entity fields the server re-projects from the copy that becomes canonical. */
function canonicalContent(copy: SourceRecord): Partial<EventRecord> {
  return {
    calendarId: copy.calendarId,
    title: copy.title,
    description: copy.description,
    location: copy.location,
    eventType: copy.eventType,
    reminders: copy.reminders,
    isReadOnly: copy.isReadOnly,
    transparency: copy.transparency,
    visibility: copy.visibility,
    creatorName: copy.creatorName,
    creatorEmail: copy.creatorEmail,
  };
}

export interface DeletionTarget {
  calendarId?: string;
  scope?: 'all' | 'this_event' | 'this_and_following';
  occurrenceKey?: string;
}

/**
 * What an optimistic deletion changes. Deleting the whole event from one
 * calendar among several retires only that copy, so the event survives with
 * the copy dropped and, when it was canonical, its content re-projected from
 * the next copy. Every other deletion cancels the covered occurrences.
 */
export function deletionPlan(
  event: EventRecord | undefined,
  occurrences: readonly OccurrenceRecord[],
  target: DeletionTarget
): { event?: EventRecord; cancelled: OccurrenceRecord[] } {
  const scope = target.scope ?? 'all';
  if (scope === 'this_event') {
    return {
      cancelled: occurrences.filter(
        (occurrence) => occurrence.occurrenceKey === target.occurrenceKey
      ),
    };
  }
  if (scope === 'this_and_following') {
    const from = target.occurrenceKey;
    // Occurrence keys within one event share a format, so ordering is
    // lexicographic.
    return {
      cancelled:
        from === undefined
          ? []
          : occurrences.filter(
              (occurrence) => occurrence.occurrenceKey >= from
            ),
    };
  }
  const sources = event?.sources ?? [];
  const removedCopy = target.calendarId ?? sources[0]?.calendarId;
  const remaining = sources.filter((copy) => copy.calendarId !== removedCopy);
  const [nextCanonical] = remaining;
  if (event && nextCanonical && remaining.length < sources.length) {
    const removesCanonical = removedCopy === sources[0]?.calendarId;
    return {
      event: {
        ...event,
        ...(removesCanonical ? canonicalContent(nextCanonical) : {}),
        sources: remaining,
      },
      cancelled: [],
    };
  }
  return { cancelled: [...occurrences] };
}
