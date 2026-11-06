import type {
  BookingInsights,
  BookingLinkDraft,
  Schedule,
} from '../../../generated/calendar/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { Team } from '../teams/team';
import { User } from '../users/user';
import { Booking } from './booking';
import { BookingLink } from './link';
import { BookingSettings } from './settings';

/** Which booking page to act on. */
export type BookingScope = {
  /** A team's booking page; omit for the user's personal page. */
  team?: Team;
};

/** What {@link BookingsNamespace.links} found. */
export type BookingLinkListing = {
  /** Matching links, paused ones included. */
  links: BookingLink[];
  /** The page's reusable weekly hours, to copy into a new link's draft. */
  schedules: Schedule[];
  /** The user, the host to put in a personal link's draft. */
  me: User;
  /** The user's teams; pass one as `team` to read its links. */
  teams: Team[];
};

/** Options for {@link BookingsNamespace.bookings}. */
export type ListBookingsOptions = BookingScope & {
  /** Earliest start, inclusive: a Date or an ISO 8601 timestamp with an offset. */
  from: Date | string;
  /** Latest start, exclusive; at most 733 days after `from`. */
  to: Date | string;
};

/** Options for {@link BookingsNamespace.insights}. */
export type BookingInsightsOptions = BookingScope & {
  /** First local date, inclusive (YYYY-MM-DD). */
  from: string;
  /** Last local date, inclusive (YYYY-MM-DD); at most 366 days after `from`. */
  to: string;
  /** IANA time zone the dates and hours are counted in. */
  timeZone: string;
  /** Count only this link's bookings. */
  link?: BookingLink;
  /** Count only bookings this host is assigned to. */
  host?: User;
};

function timestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

/**
 * Booking links (reusable pages where guests pick a time with the user or a
 * team), the meetings booked through them, booking statistics and the
 * booking page's settings. Agents find it under the calendar entity.
 *
 * @agent
 * ## Booking links
 *
 * - Start with `links()` to find existing links and reusable availability. Get team and host
 *   handles from it (`teams`, `me`) and `team.members()`; never ask the user for ids, revisions or
 *   JSON. Default to the personal page unless the user asks for a team's.
 * - `createLink` and `link.edit` save immediately; nothing reviews them. Before calling either,
 *   explain the complete proposal in readable prose: ownership and named hosts, who attends,
 *   meeting name and description, duration, location, Macro call or Google Meet, time zone, weekly
 *   hours and date exceptions, link name, buffers, minimum notice, booking window, slot interval,
 *   daily limit, guest questions, and whether bookings are enabled. Group related settings so it is
 *   easy to review. Ask whether to proceed and end the turn. Only after the user's reply approving
 *   that proposal, save it. Being asked for a link is not approval. If the same proposal is already
 *   approved, do not ask again. Do not use an elicitation for booking details.
 * - For edits start from `link.draft` and change only what was asked. On a conflict, read the
 *   links again and confirm the updated proposal rather than overwriting.
 * - Share a saved link with `link.mentionTag()` (an `<m-booking-link-mention>` chip), not a bare URL.
 *
 * ## Booked meetings
 *
 * - `cancel`, `approve` and `reschedule` notify the guest: say what will change and act only when
 *   the user asked for it. Reschedule only to a slot from `rescheduleSlots`.
 * - Use `insights` for counts and trends rather than counting `bookings` yourself.
 */
export class BookingsNamespace {
  constructor(private readonly client: MacroClient) {}

  /**
   * Find booking links, optionally matching `query` in a link's title, slug or
   * description, with the page's reusable schedules. Reading never creates a
   * page. Start here before creating a link.
   */
  async links(
    opts: BookingScope & { query?: string } = {},
  ): Promise<BookingLinkListing> {
    const listing = unwrap(
      await this.client.calendar.listBookingLinks({
        query: { teamId: opts.team?.id, query: opts.query },
      }),
    );
    return {
      links: listing.links.map((link) =>
        BookingLink.from(this.client, link, opts.team),
      ),
      schedules: listing.schedules,
      me: User.byId(this.client, listing.userId),
      teams: listing.teamIds.map((id) => Team.byId(this.client, id)),
    };
  }

  /**
   * Create a booking link from a full draft, only after the user approved the
   * proposal in conversation. A personal link has the user (`links().me`) as
   * its only host in `individual` mode; a team link takes `team` and
   * `collective` or `roundRobin` mode. Supply all seven weekdays (Sunday is 0)
   * and an IANA time zone. Set `macroCall` or `googleMeet`, never both.
   * Creating a link sends no invitations. Repeating an identical draft at the
   * same slug returns the saved link; a different draft there conflicts.
   */
  async createLink(
    draft: BookingLinkDraft,
    opts: BookingScope = {},
  ): Promise<BookingLink> {
    const { link } = unwrap(
      await this.client.calendar.createBookingLink({
        query: { teamId: opts.team?.id },
        body: draft,
      }),
    );
    return BookingLink.from(this.client, link, opts.team);
  }

  /**
   * Every meeting booked to start in `[from, to)`, with guests, answers,
   * attendance and reschedule history. Fails rather than truncating when the
   * range holds too many: narrow it.
   */
  async bookings(opts: ListBookingsOptions): Promise<Booking[]> {
    const { bookings } = unwrap(
      await this.client.calendar.listBookings({
        query: {
          teamId: opts.team?.id,
          from: timestamp(opts.from),
          to: timestamp(opts.to),
        },
      }),
    );
    return bookings.map((booking) => Booking.from(this.client, booking));
  }

  /**
   * Booking statistics for local dates `from`..`to` and the equally long
   * period before them: totals, completed, rescheduled, cancelled, no-shows,
   * scheduled minutes, daily trends, popular hours and counts by link and
   * host. Completed means confirmed and ended without a recorded no-show, not
   * verified attendance. No guest contact details are included.
   */
  async insights(opts: BookingInsightsOptions): Promise<BookingInsights> {
    return unwrap(
      await this.client.calendar.getBookingInsights({
        query: { teamId: opts.team?.id },
        body: {
          from: opts.from,
          to: opts.to,
          timeZone: opts.timeZone,
          eventTypeId: opts.link?.id,
          hostId: opts.host?.id,
        },
      }),
    );
  }

  /**
   * The booking page's full settings: name, introduction, schedules, default
   * hours and every link. Change one link with `link.edit`; save settings to
   * change the page or shared hours.
   */
  async settings(opts: BookingScope = {}): Promise<BookingSettings> {
    return BookingSettings.read(this.client, opts.team);
  }
}
