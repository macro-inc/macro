import type {
  BookingInsights,
  BookingLinkDraft,
  BookingProfile,
  BookingSchedule,
} from '../../../generated/calendar/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { Team } from '../teams/team';
import { User } from '../users/user';
import { Booking } from './booking';
import { BookingLink, bookingPageUrl } from './booking-link';

/** Whose booking links: the user's own when `team` is omitted, otherwise that team's. */
export interface BookingScope {
  /** A team the user belongs to; omit for the user's personal booking links. */
  team?: Team;
}

/** A profile's booking settings and its public booking page. */
export interface BookingSettings {
  /** Every setting, with the revision {@link BookingNamespace.saveSettings} saves against. */
  profile: BookingProfile;
  /** The public page listing the profile's links; a revision-0 profile must be saved before sharing it. */
  pageUrl: string;
}

/** The user's or a team's booking links, and what a new link can reuse. */
export interface BookingLinkListing {
  /** Matching links, paused ones included. */
  links: BookingLink[];
  /** Reusable availability schedules to copy into a new draft. */
  schedules: BookingSchedule[];
  /** The user, as the host to name in a personal draft's `hosts`. */
  host: User;
  /** The user's teams, whose links {@link BookingNamespace.links} lists with `team`. */
  teams: Team[];
  /** The profile's public booking page. */
  pageUrl: string;
}

/** A local date range for {@link BookingNamespace.insights}. */
export interface BookingInsightsQuery extends BookingScope {
  /** First local date (`YYYY-MM-DD`), inclusive. */
  from: string;
  /** Last local date (`YYYY-MM-DD`), inclusive; at most 366 days after `from`. */
  to: string;
  /** IANA zone for dates and hour-of-day grouping. */
  timeZone: string;
  /** Only bookings of this link. */
  link?: BookingLink;
  /** Only bookings this user hosts. */
  host?: User;
}

/**
 * Booking links (`macro.calendar.booking`): reusable booking pages, the
 * settings behind them, the meetings guests book through them, and their
 * statistics. Personal unless a `team` is given; any team member can read and
 * edit a team's.
 */
export class BookingNamespace {
  constructor(private readonly client: MacroClient) {}

  /**
   * List and search the user's booking links (or a team's), with their full
   * drafts, the reusable schedules and the user as host; call this before
   * creating a link. Reading never creates settings.
   *
   * `query` matches link title, slug and description; omit it for every link
   * (at most 100).
   *
   * @readonly
   */
  async links(
    options: BookingScope & { query?: string } = {},
  ): Promise<BookingLinkListing> {
    const listing = unwrap(
      await this.client.calendar.listBookingLinks({
        query: { teamId: options.team?.id, query: options.query },
      }),
    );
    return {
      links: listing.links.map((link) =>
        BookingLink.fromRecord(this.client, link, options.team),
      ),
      schedules: listing.schedules,
      host: User.byId(this.client, listing.userId),
      teams: listing.teamIds.map((id) => Team.byId(this.client, id)),
      pageUrl: bookingPageUrl(this.client, listing.profileId),
    };
  }

  /**
   * Create a booking link only after the user replied approving the full
   * proposal, quoting that reply in `userConfirmation`; never on the request
   * that asked for the link.
   *
   * List {@link links} first and reuse what fits. Before creating, write the
   * whole proposal out for the user: personal or team ownership, the named
   * hosts and who attends, meeting name and description, duration, location,
   * Macro call or Google Meet, time zone, weekly hours and date exceptions,
   * link name, buffers, minimum notice, booking window, slot interval, daily
   * limit, guest questions and whether bookings are enabled. Ask whether to
   * proceed and stop. Never ask the user for ids, revisions or JSON.
   *
   * The draft needs all seven weekdays (Sunday is 0), an IANA time zone and
   * real hosts: a personal link names {@link BookingLinkListing.host} with
   * mode `individual`; a team link uses `collective` or `roundRobin`.
   * `requiresConfirmation` must be false. For video set `macroCall`
   * (preferred) or `googleMeet`, never both. Creating sends no invitations.
   * Replaying an identical draft at the same slug returns the saved link; a
   * different draft at that slug conflicts (409). Share the link's
   * {@link BookingLink.webUrl} as an `<m-booking-link-mention>` chip.
   *
   * @write
   * @idempotent
   */
  async createLink(
    draft: BookingLinkDraft,
    options: BookingScope & { userConfirmation: string },
  ): Promise<BookingLink> {
    const link = unwrap(
      await this.client.calendar.createBookingLink({
        query: { teamId: options.team?.id },
        body: { draft, userConfirmation: options.userConfirmation },
      }),
    );
    return BookingLink.fromRecord(this.client, link, options.team);
  }

  /**
   * Read every booking setting of the user (or a team): booking-page name and
   * introduction, reusable schedules, default hours and every link. Reading
   * never creates settings.
   *
   * @readonly
   */
  async settings(options: BookingScope = {}): Promise<BookingSettings> {
    const { profile } = unwrap(
      await this.client.calendar.getBookingSettings({
        query: { teamId: options.team?.id },
      }),
    );
    return { profile, pageUrl: bookingPageUrl(this.client, profile.id) };
  }

  /**
   * Save the full settings read with {@link settings}, only after the user
   * replied approving the changes; use {@link createLink} and
   * {@link BookingLink.edit} for a single link.
   *
   * Change only what the user asked for and keep every id; generate new
   * UUIDs for new schedules, links and questions. A shared schedule's hours
   * apply to every link using it, and personal default hours apply to team
   * hosting, so name the affected links before changing them. Deleting a link
   * cancels none of its bookings. Saving at a stale revision is refused (409):
   * read again and reconcile instead of overwriting.
   *
   * @destructive
   */
  async saveSettings(
    profile: BookingProfile,
    options: BookingScope = {},
  ): Promise<BookingSettings> {
    const saved = unwrap(
      await this.client.calendar.saveBookingSettings({
        query: { teamId: options.team?.id },
        body: profile,
      }),
    ).profile;
    return { profile: saved, pageUrl: bookingPageUrl(this.client, saved.id) };
  }

  /**
   * Every booking starting in a half-open range (`from` inclusive, `to`
   * exclusive, ISO timestamps with an offset, at most 733 days apart), with
   * guests, answers, attendance and reschedule history. An oversized result
   * fails rather than truncating: narrow the range. Use {@link insights} for
   * statistics.
   *
   * @readonly
   */
  async bookings(
    options: BookingScope & { from: string; to: string },
  ): Promise<Booking[]> {
    const { bookings } = unwrap(
      await this.client.calendar.listBookings({
        query: { teamId: options.team?.id, from: options.from, to: options.to },
      }),
    );
    return bookings.map((record) => Booking.fromRecord(this.client, record));
  }

  /**
   * Booking statistics for local dates, and the equally long period before:
   * totals, completed, rescheduled, cancelled, no-shows, scheduled minutes,
   * daily trends, popular hours and counts by link and host.
   *
   * Failed and processing requests are excluded. Completed means confirmed
   * and ended without a recorded no-show, not verified attendance; minutes
   * are scheduled duration, not call length. No guest contact details.
   *
   * @readonly
   */
  async insights(query: BookingInsightsQuery): Promise<BookingInsights> {
    return unwrap(
      await this.client.calendar.getBookingInsights({
        query: { teamId: query.team?.id },
        body: {
          from: query.from,
          to: query.to,
          timeZone: query.timeZone,
          eventTypeId: query.link?.id,
          hostId: query.host?.id,
        },
      }),
    );
  }
}
