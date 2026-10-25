import type {
  CalendarAttendeeInputBody,
  ConferenceChange,
  CreateCalendarEventRequest,
  EventReminders,
  EventTime,
  EventTransparency,
  EventVisibility,
  GuestPolicy,
  OutOfOfficeProperties,
  TeamCalendarSharing,
} from '../../../generated/calendar/types.gen';
import type {
  CalendarEvent as CalendarEventRecord,
  ListOccurrencesData,
  ListTeamCalendarData,
  ListTeamOutOfOfficeData,
} from '../../../generated/storage/types.gen';
import { paginate, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { Document } from '../documents/document';
import type { Link } from '../email/link';
import { Team } from '../teams/team';
import { User } from '../users/user';
import { Calendar } from './calendar';
import { CalendarEvent } from './event';
import { CalendarReplacement } from './replacement';

/** Fields for a new calendar event. */
export interface CreateEventOptions {
  /** Display title. */
  title: string;
  /** Timed or all-day shape. */
  time: EventTime;
  /** Optional event body. */
  description?: string;
  /** Optional location label. */
  location?: string;
  /** Invited attendees. */
  attendees?: CalendarAttendeeInputBody[];
  /** Raw RFC 5545 recurrence properties (`RRULE`, `RDATE`, `EXDATE`). */
  recurrenceLines?: string[];
  /** Event visibility. */
  visibility?: EventVisibility;
  /** Availability behavior. */
  transparency?: EventTransparency;
  /** Reminder configuration; omit to keep the calendar defaults. */
  reminders?: EventReminders;
  /** Conference to attach; omit to create the event without one. */
  conference?: ConferenceChange;
  /** Mint a Macro call with the event; its join link lands in the description
   * and location. Cannot be combined with `conference`. */
  macroCall?: boolean;
  /** Out-of-office properties; present to create an out-of-office event. */
  outOfOffice?: OutOfOfficeProperties;
  /** What guests may do; omit for Google's defaults. Google calendars only. */
  guestPolicy?: GuestPolicy;
  /** Exact calendar to create the event on; takes precedence over the inbox
   * default. */
  calendar?: Calendar;
  /** Connected inbox whose primary calendar receives the event; defaults to the
   * requester's primary inbox. */
  emailLink?: Link;
}

/** What the user is on one copy of an event, through the inbox holding it:
 * its organizer (or the owner of an event without guests), or a guest. */
export type CalendarEventRole = 'organizer' | 'guest';

/**
 * The calendar surface: the caller's visible calendars, event creation, and
 * handles to individual events and calendars. Backed by calendar_service (the
 * SDK reaches it on the gateway's `/calendar` route).
 *
 * A meeting on more than one of the user's inboxes is one event per inbox;
 * {@link CalendarNamespace.occurrences} lists each copy with its `inbox` and
 * `role`. Before changing such a meeting's details, guests or guest
 * permissions, or deleting it, ask the user which inbox's copy to change, then
 * pass that copy's `inbox` to {@link CalendarEvent.update},
 * {@link CalendarEvent.inviteGuests} or {@link CalendarEvent.delete}. Never
 * choose between the user's inboxes yourself, whatever they look like: a
 * test, secondary or unfamiliar address is still the user's own inbox. Skip
 * the question only when the user already named the inbox, when only one copy
 * can make the change, or when adding guests from the copy the user
 * organizes, and say why. Reminders may go to one copy; name its inbox. Read
 * those three methods' documentation before changing a meeting held through
 * several inboxes: it says what each change does from each copy.
 */
export class CalendarNamespace {
  /** Find up to 30 owned markdown documents for meeting notes, plus available extra team audiences. */
  async noteDocuments(query = '') {
    const picker = unwrap(
      await this.client.calendar.noteDocuments({ query: { query } }),
    );
    return {
      documents: picker.documents.map((note) => ({
        document: Document.byId(this.client, note.documentId),
        name: note.name,
      })),
      teams: picker.teams.map((team) => ({
        team: Team.byId(this.client, team.id),
        name: team.name,
      })),
    };
  }

  /** Calendar availability settings, each referring to a typed calendar. */
  async availabilityCalendars() {
    return unwrap(
      await this.client.calendar.getAvailabilityCalendars(),
    ).calendars.map((record) => ({
      calendar: Calendar.byId(this.client, record.calendarId),
      name: record.name,
      isPrimary: record.isPrimary,
      contributesToAvailability: record.contributesToAvailability,
    }));
  }

  /** Current sharing preference for the team calendar. */
  async teamSharing(): Promise<TeamCalendarSharing> {
    return unwrap(await this.client.calendar.getTeamSharing()).sharing;
  }

  /** Replace the team calendar sharing preference. */
  async setTeamSharing(
    sharing: TeamCalendarSharing,
  ): Promise<TeamCalendarSharing> {
    return unwrap(
      await this.client.calendar.setTeamSharing({ body: { sharing } }),
    ).sharing;
  }

  /** Calendar occurrences in a viewport, automatically paginated. Each names
   * the address of the connected inbox holding that copy of the event
   * (`inbox`) and whether the user organizes it or is a guest there (`role`,
   * absent when neither). A meeting on several of the user's inboxes appears
   * once per inbox, each with its own event; describe them by inbox and role,
   * never by id.
   *
   * Before changing or deleting such a meeting, ask the user which inbox's
   * copy to change, unless they named it, only one copy can make the change,
   * or you add guests from the copy they organize. Never choose between the
   * user's inboxes yourself, whatever they look like. Pass the chosen copy's
   * `inbox` to its `update`, `inviteGuests` or `delete`; without it the call
   * is refused with `copy_choice_required`, which names each copy's inbox and
   * event and gives the question to ask. An occurrence whose calendar is no
   * longer listed has no `inbox`; take it from that refusal. */
  occurrences(options: Omit<ListOccurrencesData['query'], 'cursor'>) {
    let inboxes: Promise<Map<string, string>> | undefined;
    return paginate(async (cursor) => {
      const page = unwrap(
        await this.client.storage.listOccurrences({
          query: { ...options, cursor },
        }),
      );
      inboxes ??= calendarInboxes(this.client);
      const inboxByCalendar = await inboxes;
      return {
        items: page.items.map((item) => ({
          event: CalendarEvent.fromRecord(this.client, item.event),
          occurrence: item.occurrence,
          inbox: item.event.calendarId
            ? inboxByCalendar.get(item.event.calendarId)
            : undefined,
          role: eventRole(item.event),
        })),
        nextCursor: page.nextCursor,
      };
    });
  }

  /** A page of team availability, including its roster and continuation cursor. */
  async teamPage(options: NonNullable<ListTeamCalendarData['query']>) {
    const page = unwrap(
      await this.client.storage.listTeamCalendar({ query: options }),
    );
    return {
      items: page.items.map(({ ownerId, ...item }) => ({
        ...item,
        owner: User.byId(this.client, ownerId),
      })),
      members: page.members.map((member) => ({
        user: User.byId(this.client, member.userId),
        sharing: member.sharing,
        coverage: member.coverage,
      })),
      nextCursor: page.nextCursor ?? undefined,
    };
  }

  /** Teammates' out-of-office occurrences in a bounded viewport. Check hasMore for truncation. */
  async teamOutOfOffice(
    options: NonNullable<ListTeamOutOfOfficeData['query']>,
  ) {
    const page = unwrap(
      await this.client.storage.listTeamOutOfOffice({ query: options }),
    );
    return {
      items: page.items.map((item) => ({
        event: CalendarEvent.byId(this.client, item.eventId),
        owner: User.byId(this.client, item.ownerId),
        occurrenceKey: item.occurrenceKey,
        time: item.time,
        title: item.title ?? undefined,
      })),
      hasMore: page.hasMore,
    };
  }

  constructor(private readonly client: MacroClient) {}

  /** The caller's visible calendars, primaries and writable first. */
  calendars(): Promise<Calendar[]> {
    return Calendar.list(this.client);
  }

  /** A handle to a calendar by id. Detail loads on first access. */
  calendar(id: string): Calendar {
    return Calendar.byId(this.client, id);
  }

  /** A handle to a calendar event by id, for driving mutations. */
  event(id: string): CalendarEvent {
    return CalendarEvent.byId(this.client, id);
  }

  /** Recover a saved replacement, including after its original event was retired. */
  replacement(operationId: string): CalendarReplacement {
    return new CalendarReplacement(this.client, operationId);
  }

  /** Create a calendar event and return a handle to its synced record. */
  async createEvent(options: CreateEventOptions): Promise<CalendarEvent> {
    const record = unwrap(
      await this.client.calendar.createCalendarEvent({
        body: toCreateBody(options),
      }),
    );
    return CalendarEvent.fromRecord(this.client, record);
  }
}

function toCreateBody(options: CreateEventOptions): CreateCalendarEventRequest {
  return {
    title: options.title,
    time: options.time,
    description: options.description,
    location: options.location,
    attendees: options.attendees,
    recurrenceLines: options.recurrenceLines,
    visibility: options.visibility,
    transparency: options.transparency,
    reminders: options.reminders,
    conference: options.conference,
    macroCall: options.macroCall,
    outOfOffice: options.outOfOffice,
    guestPolicy: options.guestPolicy,
    calendarId: options.calendar?.id,
    emailLinkId: options.emailLink?.id,
  };
}

/** The inbox address of each calendar the caller can see, by calendar id. */
async function calendarInboxes(
  client: MacroClient,
): Promise<Map<string, string>> {
  const { calendars } = unwrap(await client.calendar.listCalendars());
  return new Map(
    calendars.map((calendar) => [calendar.id, calendar.emailAddress]),
  );
}

/** The user's role on a copy, read the way ListCalendarEvents reads it:
 * `organize` marks the organizer, and only the copy's own inbox row is
 * `isSelf`. */
function eventRole(record: CalendarEventRecord): CalendarEventRole | undefined {
  const own = record.attendees.find((attendee) => attendee.isSelf);
  if (record.viewerCan.organize || own?.isOrganizer) {
    return 'organizer';
  }
  return own ? 'guest' : undefined;
}
