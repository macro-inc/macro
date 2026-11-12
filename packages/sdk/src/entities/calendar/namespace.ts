import type {
  CreateCalendarEvent_Deserialize,
  ToolCalendarEvent,
} from '../../../generated/agent-reviews';
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
import type { Link } from '../email/link';
import { User } from '../users/user';
import { BookingNamespace } from './booking-namespace';
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
 * able to write someone else's calendar makes them neither, and neither does
 * a read-only calendar naming them organizer; `viewerCan` says what they may
 * do there. */
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
 *
 * @routing Use when working with calendar events, availability, scheduling a meeting with people, or booking links; not reminders or recurring automations, which are routines.
 *
 * @agent
 * ## Booking links
 *
 * - Booking links live under `macro.calendar.booking`. They are reusable booking pages, not
 *   calendar meetings; the meetings guests book through them are `Booking`s.
 * - Booking links use conversational confirmation in every surface. First list
 *   `macro.calendar.booking.links()` to find existing links and reusable availability. Resolve
 *   teams and hosts from what it returns; never ask for IDs, revisions or JSON. Default to
 *   personal ownership unless a team is requested. Explain the complete proposal in readable
 *   prose: ownership and named hosts, who attends, meeting name and description, duration,
 *   location, Macro call or Google Meet, time zone, weekly hours and date exceptions, link name,
 *   buffers, minimum notice, booking window, slot interval, daily limit, guest questions, and
 *   whether bookings are enabled. Group related settings so it is easy to review. Ask whether to
 *   proceed, and end the turn. Only after the user's reply approving that proposal, call
 *   `booking.createLink` or `BookingLink.edit`, quoting the reply verbatim in `userConfirmation`.
 *   Do not quote the original request or invent approval. These save immediately, with no
 *   review card. For edits preserve unrequested settings, and re-read and reconfirm if the
 *   revision conflicts. Share the saved `webUrl()` with an `<m-booking-link-mention>` chip (see
 *   Mentions), not a bare URL. If the same proposal is already approved, do not ask again.
 * - `booking.saveSettings` changes shared schedules, page settings and many links at once: explain
 *   the changes and the links they affect, and save only on the user's approving reply.
 * - Cancelling, approving or rescheduling a `Booking` notifies its guest and hosts; do it only on
 *   the user's go-ahead. Reschedule to a start from `rescheduleSlots`.
 *
 * ## Creating events
 *
 * - Nothing lands on a calendar, and no invitation goes out, without the user seeing the event. A program cannot call `createEvent`; it is refused.
 * - In an agent session, present the event as a review: `execution.reviews.create({kind: 'calendar', title, drafts})`, each draft with the same fields as `createConfirmed` (`calendarId` in place of `calendar`), then return `reviews: [await review.reference()]`. The user creates it from the card.
 * - For a prompt from a channel or document thread, where no card is seen: write the whole event into your reply (title, date and time with its time zone, duration, guests, location, conference or Macro call, recurrence), ask whether to create it, and stop. Only once the user replies approving that event, call `createConfirmed` with their reply quoted in `userConfirmation`. Being asked to schedule something is a request to draft the event, never the approval.
 */
export class CalendarNamespace {
  /**
   * Calendar availability settings, each referring to a typed calendar.
   *
   * @readonly
   */
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

  /**
   * Current sharing preference for the team calendar.
   *
   * @readonly
   */
  async teamSharing(): Promise<TeamCalendarSharing> {
    return unwrap(await this.client.calendar.getTeamSharing()).sharing;
  }

  /**
   * Replace the team calendar sharing preference.
   *
   * @write
   * @idempotent
   */
  async setTeamSharing(
    sharing: TeamCalendarSharing,
  ): Promise<TeamCalendarSharing> {
    return unwrap(
      await this.client.calendar.setTeamSharing({ body: { sharing } }),
    ).sharing;
  }

  /** Occurrences on every calendar the user can see: their schedule is only
   * `contributesToAvailability` rows and meetings they attend; call the rest
   * by `calendarName`. Automatically paginated within the viewport. Each names
   * its calendar (`calendarName`), whether a calendar holding it is on the
   * user's schedule (`contributesToAvailability`), the address of the
   * connected inbox holding that copy of the event (`inbox`) and whether the
   * user organizes it or is a guest there (`role`, absent when neither, when
   * they can only write that calendar, or when a read-only calendar names
   * them organizer).
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
   * longer listed has no `inbox`; take it from that refusal.
   *
   * @readonly
   */
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
            contributesToAvailability: onSchedule(item.event, calendarById),
            inbox: calendar?.emailAddress,
            role: eventRole(item.event, calendarById),
          };
        }),
        nextCursor: page.nextCursor,
      };
    });
  }

  /**
   * A page of team availability, including its roster and continuation cursor.
   *
   * @readonly
   */
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

  /**
   * Teammates' out-of-office occurrences in a bounded viewport. Check hasMore for truncation.
   *
   * @readonly
   */
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

  /** Booking links, their settings, booked meetings and booking statistics. */
  readonly booking: BookingNamespace;

  constructor(private readonly client: MacroClient) {
    this.booking = new BookingNamespace(client);
  }

  /**
   * When the user and their teammates are busy in a bounded UTC window (a day
   * or a week is best, at most 370 days); `freeWindows` is present only when
   * every person's data is complete, so never infer free time from missing
   * busy blocks. Always includes the user; omit `members` for the whole team,
   * or pass `[]` for only the user. Busy blocks carry no event titles, and
   * working hours are not applied.
   *
   * @readonly
   */
  async teamAvailability(opts: {
    /** Inclusive start, RFC 3339 UTC. */
    start: string;
    /** Exclusive end, RFC 3339 UTC; later than `start`. */
    end: string;
    /** At most 100 current teammates. */
    members?: User[];
  }) {
    const availability = unwrap(
      await this.client.storage.getTeamAvailability({
        body: {
          start: opts.start,
          end: opts.end,
          ...(opts.members
            ? { userIds: opts.members.map((member) => member.id) }
            : {}),
        },
      }),
    );
    return {
      start: availability.start,
      end: availability.end,
      members: availability.members.map(({ userId, ...member }) => ({
        ...member,
        user: User.byId(this.client, userId),
      })),
      freeWindows: availability.freeWindows ?? undefined,
      /** Requested people who are not current teammates; nothing about them is disclosed. */
      unknownUsers: availability.unknownUserIds.map((id) =>
        User.byId(this.client, id),
      ),
      complete: availability.complete,
      summary: availability.summary,
    };
  }

  /**
   * The calendars the caller can see, some possibly not theirs, primaries and writable first.
   *
   * @readonly
   */
  calendars(): Promise<Calendar[]> {
    return Calendar.list(this.client);
  }

  /**
   * A handle to a calendar by id. Detail loads on first access.
   *
   * @readonly
   */
  calendar(id: string): Calendar {
    return Calendar.byId(this.client, id);
  }

  /**
   * A handle to a calendar event by id, for driving mutations.
   *
   * @readonly
   */
  event(id: string): CalendarEvent {
    return CalendarEvent.byId(this.client, id);
  }

  /**
   * Recover a saved replacement, including after its original event was retired.
   *
   * @readonly
   */
  replacement(operationId: string): CalendarReplacement {
    return new CalendarReplacement(this.client, operationId);
  }

  /**
   * Create a calendar event and return a handle to its synced record; an
   * agent's program is refused (403) and creates through a review or
   * {@link createConfirmed} instead.
   *
   * @destructive
   * @openworld
   */
  async createEvent(options: CreateEventOptions): Promise<CalendarEvent> {
    const record = unwrap(
      await this.client.calendar.createCalendarEvent({
        body: toCreateBody(options),
      }),
    );
    return CalendarEvent.fromRecord(this.client, record);
  }

  /**
   * Create a calendar event only after the user replied approving it, quoting that reply in `userConfirmation`; never on the request that asked for the event.
   *
   * For a prompt from a channel or document thread: write the event out
   * there, ask whether to create it, and call this in a later turn on the
   * user's approving reply. In the agent session view, present a review
   * (`execution.reviews.create({kind: 'calendar', ...})`) instead; its card
   * is the confirmation. Takes what the CreateCalendarEvent tool takes:
   * guests, recurrence, reminders, a provider conference or a Macro call,
   * out-of-office and guest policy, and the calendar to write to. The event
   * is written to the provider at once and guests receive invitations; on an
   * error, look for the event before creating it again.
   *
   * @destructive
   * @openworld
   */
  async createConfirmed(
    options: ConfirmedEventOptions,
  ): Promise<CalendarEvent> {
    const { calendar, ...event } = options;
    const created = toolCalendarEvent(
      unwrap(
        await this.client.cognition.createConfirmedCalendarEvent({
          body: { ...event, calendarId: calendar?.id },
        }),
      ),
    );
    return CalendarEvent.byId(this.client, created.eventId);
  }
}

// The HTTP schema is opaque: the server serializes the Rust tool response,
// whose TypeScript contract is generated from the same Rust type.
function toolCalendarEvent(response: unknown): ToolCalendarEvent {
  return response as ToolCalendarEvent;
}

/** An event the user has approved in conversation, for `calendar.createConfirmed`. */
export type ConfirmedEventOptions =
  EventFields<CreateCalendarEvent_Deserialize> & {
    /** The calendar to write to; omit for the user's primary calendar. */
    calendar?: Calendar;
    /**
     * The user's own reply approving this specific event, quoted verbatim, such
     * as their "yes, go ahead" after you wrote the event out for them. Never the
     * request that asked you to schedule it, and never your own words.
     */
    userConfirmation: string;
  };

/** The tool's event fields, with the calendar taken as a handle instead. */
type EventFields<Event> = Event extends unknown
  ? Omit<Event, 'calendarId'>
  : never;

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

/** Whether a calendar holding the event is on the user's schedule, when that
 * is known. Availability counts each copy, so one such copy is enough; `false`
 * needs every copy to say so, as an older service omits the field. */
function onSchedule(
  record: CalendarEventRecord,
  calendars: Map<string, VisibleCalendar>,
): boolean | undefined {
  const known = [
    record.calendarId,
    ...(record.sources ?? []).map((copy) => copy.calendarId),
  ].flatMap((id) => {
    const calendar = id ? calendars.get(id) : undefined;
    return calendar ? [calendar.contributesToAvailability] : [];
  });
  if (known.some(Boolean)) {
    return true;
  }
  return known.length > 0 && known.every((value) => value === false)
    ? false
    : undefined;
}

/** The user's role on a copy, read the way Rust `EventRole::of` reads it: only
 * the copy's own inbox row is `isSelf`. That row marked organizer counts only
 * on a copy the user can change, since Microsoft Graph names the mailbox owner
 * as organizer on every event of a read-only calendar. `organize` says they
 * may act as organizer, which writing someone else's calendar grants too, so
 * it counts only on a calendar of their own schedule with no other organizer
 * listed. */
function eventRole(
  record: CalendarEventRecord,
  calendars: Map<string, VisibleCalendar>,
): CalendarEventRole | undefined {
  const own = record.attendees.find((attendee) => attendee.isSelf);
  if (own?.isOrganizer) {
    return record.isReadOnly ? undefined : 'organizer';
  }
  const otherOrganizer = record.attendees.some(
    (attendee) => attendee.isOrganizer,
  );
  if (
    record.viewerCan.organize &&
    onSchedule(record, calendars) &&
    !otherOrganizer
  ) {
    return 'organizer';
  }
  return own ? 'guest' : undefined;
}
