import type { EmailConnectionProviders } from '../../../generated/auth/types.gen';
import type {
  ApiSortMethod,
  TransferRecoveryResponse,
} from '../../../generated/email/types.gen';
import type { ListEmailRemindersData } from '../../../generated/storage/types.gen';
import { paginate, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import type { SearchOpts } from '../search/options';
import { EmailAttachment } from './attachment';
import { type DraftOptions, draftBody, EmailDraft } from './draft';
import { EmailFilter, type EmailFilterOptions } from './filter';
import { Label } from './label';
import { Link } from './link';
import {
  type ConfirmedEmailOptions,
  EmailMessage,
  type SendEmailOptions,
  type SentEmail,
} from './message';
import { EmailThread } from './thread';

/** Options for listing inbox threads. */
export interface InboxOptions {
  /** Page size (default 20, max 500). */
  pageSize?: number;
  /** Sort order. Defaults to `viewed_updated`. */
  sort?: ApiSortMethod;
}

/**
 * @routing Use when reading, searching, labelling, drafting or sending email, or working across several inboxes; not channel messages or calendar invites.
 *
 * @agent
 * ## Email inboxes
 *
 * - A user can have more than one inbox: their primary one, others they connected, and inboxes teammates delegated to them. `macro.email.links()` lists them; most users have one.
 * - Searching and listing span every inbox the user can access unless you pass one. When the user means a specific mailbox ("my work inbox", "the shared inbox"), find it in `links()` and pass that link; never guess an address.
 * - Labels are per inbox: a label from one inbox does not apply to a thread in another. Change a thread's labels with labels from the inbox that owns the thread.
 *
 * ## Sending email
 *
 * - Nothing leaves without the user seeing it. A program cannot call `send` or `EmailThread.reply`; they are refused, and so is a draft's `send` or `schedule` without `userConfirmation`.
 * - In an agent session, present the email as a review: `execution.reviews.create({kind: 'email', title, drafts})`, each draft with the same fields as `sendConfirmed` (Markdown `body`, `to`/`cc`/`bcc`, `from` as the inbox's address, `replyingToId`, `attachments: [{documentId}]`), then return `reviews: [await review.reference()]`. The user sends it from the card. For a forward, `await message.forwardDraft({to, body})` is the draft.
 * - For a prompt from a channel or document thread, where no card is seen: write the whole email into your reply, ask whether to send it, and stop. Only once the user replies approving that email, send it with their reply quoted in `userConfirmation`: `sendConfirmed` for a new email or a reply, `EmailMessage.forwardConfirmed` for a forward, `EmailDraft.send` or `EmailDraft.schedule` for a saved draft. Being asked to send an email is a request to draft one, never the approval.
 */
export class EmailNamespace {
  /**
   * Create a draft without sending it; the inbox defaults to the caller's primary.
   *
   * @write
   * @openworld
   */
  async createDraft(options: DraftOptions, inbox?: Link): Promise<EmailDraft> {
    const result = unwrap(
      await this.client.email.createDraft({
        body: { draft: draftBody(options) },
        headers: inbox ? { 'X-Email-Link-Id': inbox.id } : undefined,
      }),
    );
    if (!result.draft.db_id)
      throw new Error('Draft response has no message id');
    return EmailDraft.byId(this.client, result.draft.db_id);
  }

  /**
   * Construct a lazy draft handle.
   *
   * @readonly
   */
  draftById(id: string): EmailDraft {
    return EmailDraft.byId(this.client, id);
  }

  /**
   * Scheduled drafts, fetched lazily in bounded pages.
   *
   * @readonly
   */
  async *scheduled(options?: {
    pageSize?: number;
    inbox?: Link;
  }): AsyncGenerator<EmailDraft> {
    const requestedLimit = options?.pageSize ?? 100;
    if (!Number.isInteger(requestedLimit) || requestedLimit < 1)
      throw new Error('pageSize must be positive');
    const limit = Math.min(requestedLimit, 1000);
    for (let offset = 0; ; offset += limit) {
      const page = unwrap(
        await this.client.email.getScheduledMessages({
          query: { offset, limit },
          headers: options?.inbox
            ? { 'X-Email-Link-Id': options.inbox.id }
            : undefined,
        }),
      );
      for (const message of page.messages)
        yield EmailDraft.byId(this.client, message.db_id);
      if (page.messages.length < limit) return;
    }
  }

  /**
   * Importance filters.
   *
   * @readonly
   */
  async filters(inbox?: Link): Promise<EmailFilter[]> {
    return unwrap(
      await this.client.email.listEmailFilters({
        headers: inbox ? { 'X-Email-Link-Id': inbox.id } : undefined,
      }),
    ).filters.map((f) => EmailFilter.from(this.client, f, inbox));
  }

  /**
   * Create or replace a filter matching an address or domain.
   *
   * @write
   * @idempotent
   */
  async upsertFilter(
    options: EmailFilterOptions,
    inbox?: Link,
  ): Promise<EmailFilter> {
    return EmailFilter.from(
      this.client,
      unwrap(
        await this.client.email.upsertEmailFilter({
          headers: inbox ? { 'X-Email-Link-Id': inbox.id } : undefined,
          body: {
            email_address: options.emailAddress,
            email_domain: options.emailDomain,
            is_important: options.isImportant,
          },
        }),
      ).filter,
      inbox,
    );
  }

  /**
   * Address book contacts grouped by the service's interaction buckets.
   *
   * @readonly
   */
  async contacts() {
    return unwrap(await this.client.email.listContacts()).contacts;
  }

  /**
   * Follow-up reminders with thread handles, automatically paginated.
   *
   * @readonly
   */
  reminders(
    options?: Omit<
      NonNullable<ListEmailRemindersData['query']>,
      'inboxIds' | 'cursor'
    > & { inboxes?: Link[] },
  ) {
    const { inboxes, ...query } = options ?? {};
    return paginate(async (cursor) => {
      const page = unwrap(
        await this.client.storage.listEmailReminders({
          query: { ...query, inboxIds: inboxes?.map((i) => i.id), cursor },
        }),
      );
      return {
        items: page.items.map(({ threadId, ...item }) => ({
          ...item,
          thread: EmailThread.byId(this.client, threadId),
        })),
        nextCursor: page.nextCursor,
      };
    });
  }

  constructor(private readonly client: MacroClient) {}

  /** A handle to an email thread by id. */
  byId(id: string): EmailThread {
    return EmailThread.byId(this.client, id);
  }

  /**
   * A handle to an email message by id.
   *
   * @readonly
   */
  message(id: string): EmailMessage {
    return EmailMessage.byId(this.client, id);
  }

  /**
   * A handle to an email attachment by id.
   *
   * @readonly
   */
  attachment(id: string): EmailAttachment {
    return EmailAttachment.byId(this.client, id);
  }

  /**
   * A handle to a connected inbox (email link) by id.
   *
   * @readonly
   */
  link(id: string): Link {
    return Link.byId(this.client, id);
  }

  /**
   * The caller's connected inboxes (email links).
   *
   * @readonly
   */
  links(): Promise<Link[]> {
    return Link.list(this.client);
  }

  /**
   * Providers the server currently permits this caller to connect.
   *
   * @readonly
   */
  async connectionProviders(): Promise<EmailConnectionProviders> {
    return unwrap(await this.client.auth.emailConnectionProviders());
  }

  /** Recover a draft move using its original operation UUID; never starts a new move.
   * An empty committed result fences the old move so it cannot commit later.
   *
   * @write
   * @openworld
   * @idempotent
   */
  async recoverDraftTransfer(
    operationId: string,
  ): Promise<TransferRecoveryResponse> {
    return unwrap(
      await this.client.email.recoverDraftTransfer({
        path: { id: operationId },
      }),
    );
  }

  /**
   * Send a new plain-text email; an agent's program is refused (403) and
   * sends through a review or {@link sendConfirmed} instead.
   *
   * @destructive
   * @openworld
   */
  send(opts: SendEmailOptions): Promise<EmailMessage | undefined> {
    return EmailMessage.send(this.client, opts);
  }

  /**
   * Send an email only after the user replied approving it, quoting that reply in `userConfirmation`; never on the request that asked for the email.
   *
   * For a prompt from a channel or document thread: write the email out
   * there, ask whether to send it, and call this in a later turn on the
   * user's approving reply. In the agent session view, present a review
   * (`execution.reviews.create({kind: 'email', ...})`) instead; its card is
   * the confirmation. Takes what the SendEmail tool takes: a Markdown body,
   * Cc/Bcc, the inbox to send from, the message to reply to (sent in its
   * thread) and Macro documents to attach. The send takes effect at once and
   * is never retried; on an error, look for the message in the thread before
   * sending again.
   *
   * @destructive
   * @openworld
   */
  sendConfirmed(opts: ConfirmedEmailOptions): Promise<SentEmail> {
    return EmailMessage.sendConfirmed(this.client, opts);
  }

  /**
   * Search email threads by subject and content. To find a person's emails,
   * search for their quoted email address, not their name: a name only
   * matches where that display name appears. Resolve the address first, for
   * example with `macro.users.search(name)`.
   *
   * @readonly
   */
  search(query: string, opts?: SearchOpts): AsyncGenerator<EmailThread> {
    return EmailThread.search(this.client, query, opts);
  }

  /**
   * The threads in the inbox, most recent first, auto-paginated.
   *
   * @readonly
   */
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

  /**
   * A handle to a label by id.
   *
   * @readonly
   */
  label(id: string): Label {
    return Label.byId(this.client, id);
  }

  /**
   * All labels across the user's inboxes.
   *
   * @readonly
   */
  labels(): Promise<Label[]> {
    return Label.list(this.client);
  }

  /**
   * Create a user label. Returns the created label.
   *
   * @write
   * @openworld
   */
  createLabel(name: string): Promise<Label> {
    return Label.create(this.client, name);
  }

  /**
   * Archive many threads (or unarchive with `false`). Resolves to the threads
   * whose state could not change.
   *
   * @write
   * @openworld
   * @idempotent
   */
  archive(threads: EmailThread[], archived = true): Promise<EmailThread[]> {
    return EmailThread.archiveMany(this.client, threads, archived);
  }

  /**
   * Delete a label.
   *
   * @destructive
   * @openworld
   * @idempotent
   */
  async deleteLabel(label: Label): Promise<void> {
    unwrap(await this.client.email.deleteLabel({ path: { id: label.id } }));
  }

  /**
   * Block an email sender.
   *
   * @write
   * @openworld
   * @idempotent
   */
  async blockSender(email: string): Promise<void> {
    unwrap(
      await this.client.email.blockSender({ body: { email_address: email } }),
    );
  }

  /**
   * Unblock a previously blocked sender.
   *
   * @write
   * @openworld
   * @idempotent
   */
  async unblockSender(email: string): Promise<void> {
    unwrap(
      await this.client.email.unblockSender({
        body: { email_address: email },
      }),
    );
  }

  /**
   * The email addresses currently blocked.
   *
   * @readonly
   */
  async blockedSenders(): Promise<string[]> {
    return unwrap(await this.client.email.listBlockedSenders()).blocked_emails;
  }
}
