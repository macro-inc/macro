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
  VisibleCalendar,
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
 * its organizer (or the owner of an event without guests), or a guest. Being
 * able to write someone else's calendar makes them neither; `viewerCan` says
 * what they may do there. */
export type CalendarEventRole = 'organizer' | 'guest';

/**
 * The calendar surface: every calendar the caller can see (not all of them
 * theirs), event creation, and handles to individual events and calendars.
 * Backed by calendar_service (the SDK reaches it on the gateway's `/calendar`
 * route).
 *
 * The user can see calendars that are not theirs, such as a colleague's or a
 * team's. `inbox` is the account syncing a calendar, so it stays the user's
 * own address on all of them, and neither it, `isPrimary`, `isWritable` nor
 * `role` says whose calendar it is. Their schedule is the calendars with
 * `contributesToAvailability`, plus meetings they attend: only those are
 * "your calendar", and only those are conflicts when finding free time, as in
 * team availability. Anything else is what that calendar shows, not where the
 * user is or what they are doing. Call it by `calendarName`, say whose it is
 * when the name shows that, and otherwise say you cannot tell rather than
 * guess. When it overlaps a time you suggest, mention it so the user can
 * decide, since their own other calendars read the same way.
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
 *
 * {@link CalendarEvent.addToCalendar} adds a shared meeting only while none
 * of the user's calendars holds it. Refused with `already_on_calendar`, it is
 * refused on every calendar, so tell the user the meeting is already on their
 * calendar and never offer to add it to another one.
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

  /** Occurrences on every calendar the user can see, not only theirs: only
   * `contributesToAvailability` rows are their schedule; call the rest by
   * `calendarName`. Automatically paginated within the viewport. Each names
   * its calendar (`calendarName`), the address of the connected inbox holding
   * that copy of the event (`inbox`) and whether the user organizes it or is
   * a guest there (`role`, absent when neither, or when nothing shows the
   * calendar is theirs).
   *
   * `inbox` is the account syncing the calendar, so a colleague's calendar
   * reports the user's own address; it never says whose calendar it is, and
   * neither does `role`, since writing someone's calendar lets the user act
   * as its organizer. Say "your calendar", and count a conflict or busy time,
   * only for `contributesToAvailability` rows and meetings the user attends
   * (`role`), the way team availability does. Any other row is what that
   * calendar shows, not where the user is or what they are doing: "the
   * Offsites calendar has...", or "alex@example.com's calendar has..." when
   * the name shows whose it is. If it does not, say you cannot tell rather
   * than guess. When one overlaps a time you suggest, mention it so the user
   * can decide, since their own other calendars read the same way.
   *
   * A meeting on several of the user's inboxes appears once per inbox, each
   * with its own event; describe them by inbox and role, never by id.
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
    let calendars: Promise<Map<string, VisibleCalendar>> | undefined;
    return paginate(async (cursor) => {
      const page = unwrap(
        await this.client.storage.listOccurrences({
          query: { ...options, cursor },
        }),
      );
      calendars ??= visibleCalendars(this.client);
      const calendarById = await calendars;
      return {
        items: page.items.map((item) => {
          const calendar = item.event.calendarId
            ? calendarById.get(item.event.calendarId)
            : undefined;
          return {
            event: CalendarEvent.fromRecord(this.client, item.event),
            occurrence: item.occurrence,
            calendarName: calendar?.name,
            contributesToAvailability: calendar?.contributesToAvailability,
            inbox: calendar?.emailAddress,
            role: eventRole(item.event, calendar),
          };
        }),
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

  /** The calendars the caller can see, some possibly not theirs, primaries and writable first. */
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

/** The calendars the caller can see, by calendar id. */
async function visibleCalendars(
  client: MacroClient,
): Promise<Map<string, VisibleCalendar>> {
  const { calendars } = unwrap(await client.calendar.listCalendars());
  return new Map(calendars.map((calendar) => [calendar.id, calendar]));
}

/** The user's role on a copy, read the way ListCalendarEvents reads it: only
 * the copy's own inbox row is `isSelf`. `organize` says they may act as
 * organizer, which writing someone else's calendar grants too, so it counts
 * only on a calendar of their own schedule with no other organizer listed. */
function eventRole(
  record: CalendarEventRecord,
  calendar: VisibleCalendar | undefined,
): CalendarEventRole | undefined {
  const own = record.attendees.find((attendee) => attendee.isSelf);
  if (own?.isOrganizer) {
    return 'organizer';
  }
  const otherOrganizer = record.attendees.some(
    (attendee) => attendee.isOrganizer,
  );
  if (
    record.viewerCan.organize &&
    calendar?.contributesToAvailability &&
    !otherOrganizer
  ) {
    return 'organizer';
  }
  return own ? 'guest' : undefined;
}
