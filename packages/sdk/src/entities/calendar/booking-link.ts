import type {
  BookingLinkDraft,
  BookingLink as BookingLinkRecord,
} from '../../../generated/calendar/types.gen';
import { MacroNotFoundError, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { MacroEntity } from '../entity';
import type { Team } from '../teams/team';

/**
 * A reusable booking page (not a calendar meeting) on the user's or a team's
 * profile: its full draft, the profile revision to edit it at, and the URL
 * guests book through. Paused links (`enabled: false`) stay listed but accept
 * no bookings.
 */
export class BookingLink extends MacroEntity<BookingLinkRecord> {
  private constructor(
    client: MacroClient,
    id: string,
    /** The team owning the link; undefined for a personal link. */
    readonly team: Team | undefined,
    seed?: BookingLinkRecord,
  ) {
    super(client, id, seed);
  }

  protected async fetch(): Promise<BookingLinkRecord> {
    const { links } = unwrap(
      await this.client.calendar.listBookingLinks({
        query: { teamId: this.team?.id },
      }),
    );
    const found = links.find((link) => link.eventTypeId === this.id);
    if (!found)
      throw new MacroNotFoundError(`booking link ${this.id} not found`);
    return found;
  }

  /** A handle to a personal link, or a team's when `team` is given. Detail loads on first access. */
  static byId(client: MacroClient, id: string, team?: Team): BookingLink {
    return new BookingLink(client, id, team);
  }

  /** A handle seeded with a link record the service returned. */
  static fromRecord(
    client: MacroClient,
    record: BookingLinkRecord,
    team?: Team,
  ): BookingLink {
    return new BookingLink(client, record.eventTypeId, team, record);
  }

  /** The full editable configuration: event details, hosts, rules, questions and schedule. */
  readonly draft = this.field('draft');

  /** The profile revision this link was read at; {@link edit} saves against it. */
  readonly revision = this.field('revision');

  /**
   * The shareable URL guests book through.
   *
   * @readonly
   */
  async webUrl(): Promise<string> {
    return linkUrl(this.client, await this.detail.get());
  }

  /**
   * Replace this link's whole configuration, only after the user replied
   * approving the edited proposal, quoting that reply in `userConfirmation`.
   *
   * Start from {@link draft} and change only what the user asked for. Other
   * links and the personal default hours keep their settings. The edit saves
   * against {@link revision}; when someone saved in between it is refused
   * (409): read the link again and confirm the updated proposal instead of
   * overwriting their change. Returns the saved link.
   *
   * @write
   */
  async edit(
    draft: BookingLinkDraft,
    options: { userConfirmation: string },
  ): Promise<BookingLink> {
    const expectedRevision = await this.revision();
    const saved = await this.mutate((client) =>
      client.calendar.editBookingLink({
        path: { id: this.id },
        query: { teamId: this.team?.id },
        body: {
          expectedRevision,
          draft,
          userConfirmation: options.userConfirmation,
        },
      }),
    );
    return BookingLink.fromRecord(this.client, saved, this.team);
  }

  override toJSON() {
    const detail = this.detail.peek();
    return detail === undefined
      ? super.toJSON()
      : { ...super.toJSON(), url: linkUrl(this.client, detail) };
  }
}

/** The public booking page of a profile, or of one link on it. */
export function bookingPageUrl(
  client: MacroClient,
  profileId: string,
  slug?: string,
): string {
  const page = `${client.webAppUrl}/app/book/${profileId}`;
  return slug === undefined ? page : `${page}/${slug}`;
}

function linkUrl(client: MacroClient, record: BookingLinkRecord): string {
  return bookingPageUrl(client, record.profileId, record.draft.event.slug);
}
