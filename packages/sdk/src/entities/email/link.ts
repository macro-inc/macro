import type { Link as LinkRecord } from '../../../generated/email/types.gen';
import { MacroNotFoundError, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { MacroEntity } from '../entity';

/**
 * An email link: a connected inbox (e.g. a Gmail account) that threads and
 * messages sync through. A free-to-construct handle, resolved from the
 * caller's connected links.
 */
export class Link extends MacroEntity<LinkRecord> {
  protected async fetch(): Promise<LinkRecord> {
    const { links } = unwrap(await this.client.email.listLinks());
    const link = links.find((l) => l.id === this.id);
    if (!link) throw new MacroNotFoundError(`email link ${this.id} not found`);
    return link;
  }

  /** A handle to an email link by id. Details load on first access. */
  static byId(client: MacroClient, id: string): Link {
    return new Link(client, id);
  }

  /** The caller's connected email links. */
  static async list(client: MacroClient): Promise<Link[]> {
    const { links } = unwrap(await client.email.listLinks());
    return links.map((l) => new Link(client, l.id, l));
  }

  /** The inbox's email address. */
  readonly emailAddress = this.field('email_address');

  /** The email provider (e.g. `GMAIL`). */
  readonly provider = this.field('provider');

  /** Whether this is the user's primary inbox. */
  readonly isPrimary = this.field('is_primary');

  /** Whether syncing is currently active for this inbox. */
  readonly isSyncActive = this.field('is_sync_active');

  /** The inbox's sync status. */
  readonly syncStatus = this.field('sync_status');

  /** Whether the inbox needs to be re-authenticated. */
  readonly needsReauth = this.field('needs_reauth');

  /** The inbox's avatar URL, if any. */
  readonly photoUrl = this.field('photo_url');
}
