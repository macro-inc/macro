import type {
  AttendeeResponseStatus,
  CalendarAttendeeInputBody,
  CalendarDeletionScopeParam,
  CalendarEvent as CalendarEventRecord,
  CalendarGuestInputBody,
  CalendarRsvpScopeParam,
  CalendarUpdateScopeParam,
  ConferenceChange,
  EventReminders,
  EventTime,
  EventTransparency,
  EventVisibility,
  GuestPolicy,
  OutOfOfficeProperties,
  UpdateCalendarEventRequest,
} from '../../../generated/calendar/types.gen';
import type { CalendarOccurrence } from '../../../generated/storage/types.gen';
import { MacroError, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import type { Document } from '../documents/document';
import { MacroEntity } from '../entity';
import type { Team } from '../teams/team';
import { Calendar } from './calendar';
import { CalendarNote } from './note';
import { CalendarReplacement } from './replacement';

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
  /** Provider conference change; omit to retain it. Outlook removal requires a
   * separately confirmed replacement via prepareReplacement(). */
  conference?: ConferenceChange;
  /** Replacement out-of-office properties, applied only to an event that is
   * already out-of-office. */
  outOfOffice?: OutOfOfficeProperties;
  /** Replacement guest policy; only the organizer of a Google event may change
   * it (`viewerCan.setGuestPolicy`). It applies to the whole series, so an
   * update scoped to one occurrence (`scope: 'this_event'`, or a `recurrenceId`)
   * that changes it is rejected; use scope `'all'`. */
  guestPolicy?: GuestPolicy;
  /** How much of a recurring series the update covers. Omit to let
   * `recurrenceId` decide. */
  scope?: CalendarUpdateScopeParam;
  /** Original-start key of the occurrence the update targets. */
  recurrenceId?: string;
  /** Calendar whose copy of the event is patched, for a multi-calendar event.
   * Omit to patch the canonical copy. */
  calendar?: Calendar;
  /** Address of the inbox holding the copy this call changes (an occurrence
   * listing's `inbox`). When the meeting is on more than one of the user's
   * inboxes, an agent must name it: the call is refused with
   * `copy_choice_required`, listing each copy's inbox, role and event, until
   * it does. It must be the inbox holding this copy. */
  inbox?: string;
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
  /** Address of the inbox holding the copy this call deletes (an occurrence
   * listing's `inbox`). When the meeting is on more than one of the user's
   * inboxes, an agent must name it: the call is refused with
   * `copy_choice_required`, listing each copy's inbox, role and event, until
   * it does. It must be the inbox holding this copy. */
  inbox?: string;
}

/** Guests to add and how much of a recurring series gains them. */
export interface InviteGuestsOptions {
  /** Guests to add; anyone already on the event is skipped. */
  guests: CalendarGuestInputBody[];
  /** How much of a recurring series gains the guests. Omit to let
   * `recurrenceId` decide. */
  scope?: CalendarUpdateScopeParam;
  /** Original-start key of the occurrence the guests are added to. */
  recurrenceId?: string;
  /** Calendar whose copy of the event is written, for a multi-calendar event.
   * Omit to write the canonical copy. */
  calendar?: Calendar;
  /** Address of the inbox holding the copy this call changes (an occurrence
   * listing's `inbox`). When the meeting is on more than one of the user's
   * inboxes, an agent must name it: the call is refused with
   * `copy_choice_required`, listing each copy's inbox, role and event, until
   * it does. It must be the inbox holding this copy. */
  inbox?: string;
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
  /** Notes linked to a specific occurrence returned by `calendar.occurrences()`. */
  async notes(occurrence: CalendarOccurrence): Promise<CalendarNote[]> {
    this.requireOwnOccurrence(occurrence);
    const notes = unwrap(
      await this.client.calendar.eventNotes({
        path: { event_id: this.id },
        query: { occurrenceKey: occurrence.occurrenceKey },
      }),
    );
    return notes.map((note) =>
      CalendarNote.fromRecord(this.client, this, occurrence, note),
    );
  }

  /** Link a markdown document you own. Meeting-detail viewers gain read access;
   * an optional team gains read access too. Editing and other sharing are preserved. */
  async linkNote(
    document: Document,
    occurrence: CalendarOccurrence,
    options: { team?: Team } = {},
  ): Promise<CalendarNote> {
    this.requireOwnOccurrence(occurrence);
    unwrap(
      await this.client.calendar.linkEventNote({
        path: { event_id: this.id, document_id: document.id },
        query: { occurrenceKey: occurrence.occurrenceKey },
        body: { teamId: options.team?.id ?? null },
      }),
    );
    return CalendarNote.forDocument(this.client, this, occurrence, document);
  }

  private requireOwnOccurrence(occurrence: CalendarOccurrence) {
    if (occurrence.eventId !== this.id)
      throw new MacroError('The occurrence belongs to a different event');
  }

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

  /** What the organizer lets guests do: modify, invite others, see the guest list. */
  readonly guestPolicy = this.field('guestPolicy');

  /** What the connected account may do with this event under its guest policy. */
  readonly viewerCan = this.field('viewerCan');

  /** The calendar the canonical source belongs to, when known. */
  readonly calendar = this.mappedField('calendarId', (id) =>
    id ? Calendar.byId(this.client, id) : undefined,
  );

  /** The full synced event record. Available on a seeded handle (from create /
   * update / rsvp); a bare `byId` handle throws (no fetch-by-id endpoint). */
  record(): Promise<CalendarEventRecord> {
    return this.detail.get();
  }

  /** Update the event and return a handle to its synced record.
   *
   * A meeting on more than one of the user's inboxes is one event per inbox,
   * each with its own id (see the occurrence listing's `inbox` and `role`).
   * Before changing its details, guests or guest permissions, ask the user
   * which inbox's copy to change, then pass that copy's `inbox`. Never choose
   * between the user's inboxes yourself, whatever they look like: a test,
   * secondary or unfamiliar address is still the user's own inbox. Skip the
   * question only when the user already named the inbox, when only one copy's
   * `viewerCan` allows the change (use it and say why), or when adding guests
   * to a meeting the user organizes from one of the inboxes (add them from
   * that copy and say why). Reminders belong to one copy, so set them on one
   * copy and say which inbox you used. Without `inbox` the call is refused
   * with `copy_choice_required`, listing each copy and the question to ask. */
  async update(options: UpdateEventOptions): Promise<CalendarEvent> {
    const record = await this.mutate((client) =>
      client.calendar.updateCalendarEvent({
        path: { event_id: this.id },
        body: toUpdateBody(options),
      }),
    );
    return CalendarEvent.fromRecord(this.client, record);
  }

  /** Delete the event (or a scoped part of a recurring series) at its provider.
   *
   * A meeting on more than one of the user's inboxes is one event per inbox.
   * Before deleting any of them, ask the user which inbox's copy to delete,
   * then pass that copy's `inbox`. Never choose between the user's inboxes
   * yourself, whatever they look like: a test, secondary or unfamiliar address
   * is still the user's own inbox. Skip the question only when the user
   * already named the inbox, or when only one copy can be deleted; then delete
   * that copy and say why. Without `inbox` the call is refused with
   * `copy_choice_required`, listing each copy and the question to ask.
   *
   * Deleting the copy the user organizes cancels the meeting for every guest.
   * Deleting a copy where they are a guest takes the meeting off that inbox's
   * calendar: on Google it also declines the invitation and tells the
   * organizer, while on Outlook the organizer is not told and still sees the
   * invitation unanswered. */
  async delete(options: DeleteEventOptions = {}): Promise<void> {
    await this.mutate((client) =>
      client.calendar.deleteCalendarEvent({
        path: { event_id: this.id },
        query: {
          calendarId: options.calendar?.id,
          scope: options.scope,
          recurrenceId: options.recurrenceId,
          inbox: options.inbox,
        },
      }),
    );
  }

  /** Preview an organizer replacement without cancelling or sending invitations.
   * Review replacement.status() before explicitly calling replacement.confirm(). */
  async prepareReplacement(options: {
    removeConference: boolean;
    recurrenceId?: string;
    calendar?: Calendar;
  }): Promise<CalendarReplacement> {
    const preview = unwrap(
      await this.client.calendar.prepareCalendarReplacement({
        path: { event_id: this.id },
        body: {
          removeConference: options.removeConference,
          recurrenceId: options.recurrenceId,
          calendarId: options.calendar?.id,
        },
      }),
    );
    return new CalendarReplacement(this.client, preview.operationId);
  }

  /** Open this calendar copy in its provider for actions unavailable through its API. */
  async providerUrl(
    options: { recurrenceId?: string; calendar?: Calendar } = {},
  ): Promise<string | undefined> {
    const result = unwrap(
      await this.client.calendar.calendarEventProviderUrl({
        path: { event_id: this.id },
        query: {
          recurrenceId: options.recurrenceId,
          calendarId: options.calendar?.id,
        },
      }),
    );
    return result.url ?? undefined;
  }

  /** Add guests without touching anyone already invited, and return a handle
   * to the synced record.
   *
   * When the meeting is on more than one of the user's inboxes, add from the
   * copy the user organizes when there is one (it invites directly, while a
   * guest's copy invites only as far as the organizer allows) and say why;
   * otherwise ask the user which inbox's copy to add them from. Never choose
   * between the user's inboxes any other way, whatever they look like. Pass
   * that copy's `inbox`; without it the call is refused with
   * `copy_choice_required`, listing each copy and the question to ask.
   *
   * The organizer may add guests, and so may a guest the organizer lets
   * invite others (see {@link CalendarEvent.viewerCan}); Google emails the
   * new guests. */
  async inviteGuests(options: InviteGuestsOptions): Promise<CalendarEvent> {
    const record = await this.mutate((client) =>
      client.calendar.inviteCalendarEventGuests({
        path: { event_id: this.id },
        body: {
          guests: options.guests,
          scope: options.scope,
          recurrenceId: options.recurrenceId,
          calendarId: options.calendar?.id,
          inbox: options.inbox,
        },
      }),
    );
    return CalendarEvent.fromRecord(this.client, record);
  }

  /** Add a snapshot of an event shared with one of the requester's
   * channels to one of their Google calendars, and return a handle to the
   * synced snapshot. The snapshot keeps the meeting's iCalendar UID and
   * organizer, lists only the requester as a guest, and carries no join link;
   * nobody is notified, and answers or guests on it never reach the meeting.
   * Refused with `already_on_calendar` when the meeting is already on one of
   * their calendars, whichever calendar is named, so it cannot be added to
   * another of their calendars either; with `join_request_open` while their
   * request to join it is pending or accepted (the meeting then arrives as an
   * invitation); and with `copy_refused` when Google will not import it. */
  async addToCalendar(
    options: { calendar?: Calendar } = {},
  ): Promise<CalendarEvent> {
    const record = await this.mutate((client) =>
      client.calendar.copyCalendarEvent({
        path: { event_id: this.id },
        body: { calendarId: options.calendar?.id },
      }),
    );
    return CalendarEvent.fromRecord(this.client, record);
  }

  /** The event as an iCalendar (`.ics`) document: its series, title,
   * description, location and organizer, never its guests or join link.
   * Available for the requester's own events and ones shared with a channel
   * they belong to. */
  async ics(): Promise<string> {
    return unwrap(
      await this.client.storage.eventIcs({ path: { event_id: this.id } }),
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
    guestPolicy: options.guestPolicy,
    scope: options.scope,
    recurrenceId: options.recurrenceId,
    calendarId: options.calendar?.id,
    inbox: options.inbox,
  };
}
