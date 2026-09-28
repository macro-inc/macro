import type {
  AttendeeResponseStatus,
  CalendarAttendeeInputBody,
  CalendarDeletionScopeParam,
  CalendarEvent as CalendarEventRecord,
  CalendarRsvpScopeParam,
  CalendarUpdateScopeParam,
  ConferenceChange,
  EventReminders,
  EventTime,
  EventTransparency,
  EventVisibility,
  OutOfOfficeProperties,
  UpdateCalendarEventRequest,
} from '../../../generated/calendar/types.gen';
import { MacroError } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { MacroEntity } from '../entity';
import { Calendar } from './calendar';

/** Fields to change on an event; omitted fields are left untouched. */
export interface UpdateEventOptions {
  /** Replacement title; an empty string clears it. */
  title?: string;
  /** Replacement description; an empty string clears it. */
  description?: string;
  /** Replacement location; an empty string clears it. */
  location?: string;
  /** Replacement time. */
  time?: EventTime;
  /** Replacement attendee list. */
  attendees?: CalendarAttendeeInputBody[];
  /** Replacement recurrence properties; an empty list clears them. */
  recurrenceLines?: string[];
  /** Replacement visibility. */
  visibility?: EventVisibility;
  /** Replacement availability behavior. */
  transparency?: EventTransparency;
  /** Replacement reminder configuration. */
  reminders?: EventReminders;
  /** `google_meet` attaches a fresh Meet, `none` detaches; omit to leave the
   * conference untouched. */
  conference?: ConferenceChange;
  /** Replacement out-of-office properties, applied only to an event that is
   * already out-of-office. */
  outOfOffice?: OutOfOfficeProperties;
  /** How much of a recurring series the update covers. Omit to let
   * `recurrenceId` decide. */
  scope?: CalendarUpdateScopeParam;
  /** Original-start key of the occurrence the update targets. */
  recurrenceId?: string;
  /** Calendar whose copy of the event is patched, for a multi-calendar event.
   * Omit to patch the canonical copy. */
  calendar?: Calendar;
}

/** How a deletion is scoped across a recurring series. */
export interface DeleteEventOptions {
  /** Deletion scope; defaults to the entire event or series. */
  scope?: CalendarDeletionScopeParam;
  /** Original-start key of the occurrence a scoped deletion targets. */
  recurrenceId?: string;
  /** Calendar whose copy of the event is deleted, for a multi-calendar event.
   * Omit to delete the canonical copy. */
  calendar?: Calendar;
}

/** The RSVP to record and how it is scoped across a recurring series. */
export interface RsvpEventOptions {
  /** The response to record for the connected account. */
  response: AttendeeResponseStatus;
  /** How much of a recurring series the response covers. Omit to let
   * `recurrenceId` decide. */
  scope?: CalendarRsvpScopeParam;
  /** Original-start key of the occurrence the response targets. */
  recurrenceId?: string;
  /** Calendar whose copy of the event is answered, for a multi-calendar event.
   * Omit to answer on the canonical copy. */
  calendar?: Calendar;
}

/**
 * A Macro calendar event: a handle exposing the event's synced fields and the
 * mutations that act on it ({@link CalendarEvent.update},
 * {@link CalendarEvent.delete}, {@link CalendarEvent.rsvp}).
 *
 * The calendar service has no fetch-by-id endpoint, so a handle reads its
 * fields only when seeded with a record — as returned by
 * {@link CalendarEvent.update}, {@link CalendarEvent.rsvp}, or
 * `calendar.createEvent`. A bare {@link CalendarEvent.byId} handle can drive
 * mutations, but reading a field on it throws.
 */
export class CalendarEvent extends MacroEntity<CalendarEventRecord> {
  protected async fetch(): Promise<CalendarEventRecord> {
    throw new MacroError(
      `calendar event ${this.id} has no fetch-by-id endpoint; read the record ` +
        `returned by calendar.createEvent / event.update / event.rsvp instead`,
    );
  }

  /** A handle to a calendar event by id, for driving mutations. Reading a
   * field on it throws (there is no fetch-by-id endpoint). */
  static byId(client: MacroClient, id: string): CalendarEvent {
    return new CalendarEvent(client, id);
  }

  /** A handle seeded with a synced event record; reads resolve without a fetch. */
  static fromRecord(
    client: MacroClient,
    record: CalendarEventRecord,
  ): CalendarEvent {
    return new CalendarEvent(client, record.id, record);
  }

  /** Display title. */
  readonly title = this.field('title');

  /** Optional event body. */
  readonly description = this.field('description');

  /** Optional physical or virtual location label. */
  readonly location = this.field('location');

  /** Timed or all-day shape. */
  readonly time = this.field('time');

  /** Event status. */
  readonly status = this.field('status');

  /** Attendees on the canonical copy. */
  readonly attendees = this.field('attendees');

  /** Availability behavior. */
  readonly transparency = this.field('transparency');

  /** Whether the canonical source's calendar prohibits editing. */
  readonly isReadOnly = this.field('isReadOnly');

  /** Raw RFC 5545 recurrence properties (`RRULE`, `RDATE`, `EXDATE`). */
  readonly recurrenceLines = this.field('recurrenceLines');

  /** The calendar the canonical source belongs to, when known. */
  readonly calendar = this.mappedField('calendarId', (id) =>
    id ? Calendar.byId(this.client, id) : undefined,
  );

  /** The full synced event record. Available on a seeded handle (from create /
   * update / rsvp); a bare `byId` handle throws (no fetch-by-id endpoint). */
  record(): Promise<CalendarEventRecord> {
    return this.detail.get();
  }

  /** Update the event and return a handle to its synced record. */
  async update(options: UpdateEventOptions): Promise<CalendarEvent> {
    const record = await this.mutate((client) =>
      client.calendar.updateCalendarEvent({
        path: { event_id: this.id },
        body: toUpdateBody(options),
      }),
    );
    return CalendarEvent.fromRecord(this.client, record);
  }

  /** Delete the event (or a scoped part of a recurring series) at its provider. */
  async delete(options: DeleteEventOptions = {}): Promise<void> {
    await this.mutate((client) =>
      client.calendar.deleteCalendarEvent({
        path: { event_id: this.id },
        query: {
          calendarId: options.calendar?.id,
          scope: options.scope,
          recurrenceId: options.recurrenceId,
        },
      }),
    );
  }

  /** Record the requester's RSVP and return a handle to the synced record. */
  async rsvp(options: RsvpEventOptions): Promise<CalendarEvent> {
    const record = await this.mutate((client) =>
      client.calendar.rsvpCalendarEvent({
        path: { event_id: this.id },
        body: {
          response: options.response,
          scope: options.scope,
          recurrenceId: options.recurrenceId,
          calendarId: options.calendar?.id,
        },
      }),
    );
    return CalendarEvent.fromRecord(this.client, record);
  }
}

function toUpdateBody(options: UpdateEventOptions): UpdateCalendarEventRequest {
  return {
    title: options.title,
    description: options.description,
    location: options.location,
    time: options.time,
    attendees: options.attendees,
    recurrenceLines: options.recurrenceLines,
    visibility: options.visibility,
    transparency: options.transparency,
    reminders: options.reminders,
    conference: options.conference,
    outOfOffice: options.outOfOffice,
    scope: options.scope,
    recurrenceId: options.recurrenceId,
    calendarId: options.calendar?.id,
  };
}
