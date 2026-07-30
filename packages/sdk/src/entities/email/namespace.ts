import type { ApiSortMethod } from '../../../generated/email/types.gen';
import { paginate, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import type { SearchOpts } from '../search';
import { EmailAttachment } from './attachment';
import { Label } from './label';
import { Link } from './link';
import { EmailMessage, type SendEmailOptions } from './message';
import { EmailThread } from './thread';

/** Options for listing inbox threads. */
export interface InboxOptions {
  /** Page size (default 20, max 500). */
  pageSize?: number;
  /** Sort order. Defaults to `viewed_updated`. */
  sort?: ApiSortMethod;
}

export class EmailNamespace {
  constructor(private readonly client: MacroClient) {}

  /** A handle to an email thread by id. */
  byId(id: string): EmailThread {
    return EmailThread.byId(this.client, id);
  }

  /** A handle to an email message by id. */
  message(id: string): EmailMessage {
    return EmailMessage.byId(this.client, id);
  }

  /** A handle to an email attachment by id. */
  attachment(id: string): EmailAttachment {
    return EmailAttachment.byId(this.client, id);
  }

  /** A handle to a connected inbox (email link) by id. */
  link(id: string): Link {
    return Link.byId(this.client, id);
  }

  /** The caller's connected inboxes (email links). */
  links(): Promise<Link[]> {
    return Link.list(this.client);
  }

  /** Send a new email message. */
  send(opts: SendEmailOptions): Promise<EmailMessage | undefined> {
    return EmailMessage.send(this.client, opts);
  }

  /** Search email threads by subject and content. */
  search(query: string, opts?: SearchOpts): AsyncGenerator<EmailThread> {
    return EmailThread.search(this.client, query, opts);
  }

  /** The threads in the inbox, most recent first, auto-paginated. */
  inbox(opts?: InboxOptions): AsyncGenerator<EmailThread> {
    return paginate(async (cursor) => {
      const page = unwrap(
        await this.client.email.previewsInboxCursor({
          path: { view: 'inbox' },
          query: {
            ...(opts?.pageSize ? { limit: opts.pageSize } : {}),
            ...(opts?.sort ? { sort_method: opts.sort } : {}),
            ...(cursor ? { cursor } : {}),
          },
        }),
      );
      return {
        items: page.items.map((t) => EmailThread.byId(this.client, t.id)),
        nextCursor: page.next_cursor,
      };
    });
  }

  /** A handle to a label by id. */
  label(id: string): Label {
    return Label.byId(this.client, id);
  }

  /** All labels across the user's inboxes. */
  labels(): Promise<Label[]> {
    return Label.list(this.client);
  }

  /** Create a user label. Returns the created label. */
  createLabel(name: string): Promise<Label> {
    return Label.create(this.client, name);
  }

  /** Delete a label. */
  async deleteLabel(label: Label): Promise<void> {
    unwrap(await this.client.email.deleteLabel({ path: { id: label.id } }));
  }

  /** Block an email sender. */
  async blockSender(email: string): Promise<void> {
    unwrap(
      await this.client.email.blockSender({ body: { email_address: email } }),
    );
  }

  /** Unblock a previously blocked sender. */
  async unblockSender(email: string): Promise<void> {
    unwrap(
      await this.client.email.unblockSender({
        body: { email_address: email },
      }),
    );
  }

  /** The email addresses currently blocked. */
  async blockedSenders(): Promise<string[]> {
    return unwrap(await this.client.email.listBlockedSenders()).blocked_emails;
  }
}
