import type { Profile } from '../../../generated/calendar/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { MacroEntity } from '../entity';
import type { Team } from '../teams/team';

/**
 * A personal or team booking page's full configuration: its name and
 * introduction, reusable schedules, default hours and every link. Each handle
 * is the configuration as it was read; {@link BookingSettings.save} returns
 * the saved one.
 */
export class BookingSettings extends MacroEntity<Profile> {
  private constructor(
    client: MacroClient,
    private readonly record: Profile,
    /** The team whose page this is; undefined for the personal page. */
    readonly team: Team | undefined,
  ) {
    super(client, record.id, record);
  }

  /** Read a personal or team page's settings without creating them. */
  static async read(
    client: MacroClient,
    team: Team | undefined,
  ): Promise<BookingSettings> {
    const { profile } = unwrap(
      await client.calendar.getBookingSettings({ query: { teamId: team?.id } }),
    );
    return new BookingSettings(client, profile, team);
  }

  protected async fetch(): Promise<Profile> {
    return this.record;
  }

  /**
   * The full configuration as read, including `revision`. A revision of zero
   * means the page was never saved and has no public address yet.
   */
  get profile(): Profile {
    return this.record;
  }

  /**
   * Save a full edited copy of {@link BookingSettings.profile}. It replaces
   * the page's whole configuration, so change only what the user asked for.
   * Fails with a conflict when the page changed since it was read; read it
   * again and confirm the change again rather than overwriting.
   */
  async save(profile: Profile): Promise<BookingSettings> {
    const saved = unwrap(
      await this.client.calendar.saveBookingSettings({
        query: { teamId: this.team?.id },
        body: { ...profile, revision: this.record.revision },
      }),
    ).profile;
    return new BookingSettings(this.client, saved, this.team);
  }

  /** The public page listing every enabled link. */
  webUrl(): string {
    return `${this.client.webAppUrl}/app/book/${this.record.id}`;
  }

  override toJSON(): { id: string; detail?: Profile; url: string } {
    return { ...super.toJSON(), url: this.webUrl() };
  }
}
