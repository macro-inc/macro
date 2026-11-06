import type {
  BookingLinkDraft,
  BookingLink as BookingLinkRecord,
} from '../../../generated/calendar/types.gen';
import { wrapXml } from '../../mentions';
import { MacroNotFoundError, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { MacroEntity } from '../entity';
import type { Team } from '../teams/team';

/**
 * A reusable booking page for one kind of meeting, personal or a team's: the
 * public page guests pick a time on, not a calendar meeting. Each handle is
 * the link as it was read; {@link BookingLink.edit} returns the saved one.
 */
export class BookingLink extends MacroEntity<BookingLinkRecord> {
  private constructor(
    client: MacroClient,
    private readonly record: BookingLinkRecord,
    /** The team whose page holds the link; undefined for a personal link. */
    readonly team: Team | undefined,
  ) {
    super(client, record.eventTypeId, record);
  }

  /** Seed from a listed, created or edited link. */
  static from(
    client: MacroClient,
    record: BookingLinkRecord,
    team: Team | undefined,
  ): BookingLink {
    return new BookingLink(client, record, team);
  }

  protected async fetch(): Promise<BookingLinkRecord> {
    const listing = unwrap(
      await this.client.calendar.listBookingLinks({
        query: { teamId: this.team?.id },
      }),
    );
    const link = listing.links.find(
      (candidate) => candidate.eventTypeId === this.id,
    );
    if (!link)
      throw new MacroNotFoundError(`booking link ${this.id} not found`);
    return link;
  }

  /**
   * Every editable rule: public details, hosts, booking limits, questions and
   * the link's own weekly hours, as of this read.
   */
  get draft(): BookingLinkDraft {
    return this.record.draft;
  }

  /** The page revision this link was read at; {@link BookingLink.edit} saves against it. */
  get revision(): number {
    return this.record.revision;
  }

  /**
   * Replace this link's rules with a full edited draft. Start from
   * {@link BookingLink.draft} and change only what the user asked for: the
   * draft replaces every setting. Changed hours apply to this link only. Fails
   * with a conflict when the page changed since this link was read; read it
   * again with `bookings.links()` and confirm the change again rather than
   * overwriting. Returns the saved link.
   */
  async edit(draft: BookingLinkDraft): Promise<BookingLink> {
    const { link } = unwrap(
      await this.client.calendar.editBookingLink({
        path: { id: this.id },
        query: { teamId: this.team?.id },
        body: { expectedRevision: this.revision, draft },
      }),
    );
    return BookingLink.from(this.client, link, this.team);
  }

  /** The public page guests book on. */
  webUrl(): string {
    return `${this.client.webAppUrl}/app/book/${this.record.profileId}/${this.record.draft.event.slug}`;
  }

  /**
   * The `<m-booking-link-mention>` chip for this link. Write it into Markdown
   * (documents, channel messages, replies) in place of the bare URL.
   */
  mentionTag(): string {
    return wrapXml('m-booking-link-mention', {
      profileId: this.record.profileId,
      slug: this.record.draft.event.slug,
      url: this.webUrl(),
      label: '',
    });
  }

  override toJSON(): {
    id: string;
    detail?: BookingLinkRecord;
    url: string;
  } {
    return { ...super.toJSON(), url: this.webUrl() };
  }
}
