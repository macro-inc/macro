import type {
  ApiContactInfo,
  ApiDraftContactInfo,
  GetThreadResponses,
} from '../../../generated/email/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { PropertiedEntity } from '../entity';
import { Project } from '../projects/project';
import { entitySearch } from '../search';
import { EmailAttachment } from './attachment';
import type { Label } from './label';
import { Link } from './link';
import { EmailMessage } from './message';

type ThreadDetail = GetThreadResponses[200]['thread'];

/** Options for replying within an email thread. */
export interface ReplyEmailOptions {
  /** Recipients. */
  to: ApiDraftContactInfo[];
  /** Cc recipients. */
  cc?: ApiDraftContactInfo[];
  /** Bcc recipients. */
  bcc?: ApiDraftContactInfo[];
  /** Plain-text body. */
  bodyText: string;
  /** Subject line. Defaults to the subject of the thread's first message. */
  subject?: string;
  /** The message being replied to. */
  replyingTo?: EmailMessage;
}

/**
 * An email thread. A free-to-construct handle: the detail record (including
 * up to the first 100 messages) loads lazily on first field access.
 */
export class EmailThread extends PropertiedEntity<ThreadDetail> {
  /** Favorites identify email threads as `email_thread`. */
  readonly entityType = 'email_thread';

  /** The properties service identifies email threads as `THREAD`. */
  protected readonly propertyEntityType = 'THREAD';

  protected async fetch(): Promise<ThreadDetail> {
    const { thread } = unwrap(
      await this.client.email.getThread({
        path: { thread_id: this.id },
        query: { limit: 100 },
      }),
    );
    return thread;
  }

  /** A handle to a thread by id. Details load on first access. */
  static byId(client: MacroClient, id: string): EmailThread {
    return new EmailThread(client, id);
  }

  /** When the thread was created. */
  readonly createdAt = this.field('created_at');

  /** When the thread was last updated. */
  readonly updatedAt = this.field('updated_at');

  /** Whether the thread has been read. */
  readonly isRead = this.field('is_read');

  /** Whether the thread is visible in the inbox (i.e. not archived). */
  readonly inboxVisible = this.field('inbox_visible');

  /** The viewer's access level to this thread. */
  readonly accessLevel = this.field('access_level');

  /** The provider-internal thread id (e.g. Gmail/Outlook), if any. */
  readonly providerId = this.field('provider_id');

  /** The inbox (email link) that owns this thread. */
  readonly link = this.mappedField('link_id', (id) =>
    Link.byId(this.client, id),
  );

  /** The project this thread is attached to, if any. */
  readonly project = this.mappedField('project_id', (id) =>
    id ? Project.byId(this.client, id) : undefined,
  );

  /** Timestamp of the latest inbound message, if any. */
  readonly latestInboundAt = this.field('latest_inbound_message_ts');

  /** Timestamp of the latest outbound message, if any. */
  readonly latestOutboundAt = this.field('latest_outbound_message_ts');

  /** Timestamp of the latest non-spam message, if any. */
  readonly latestNonSpamAt = this.field('latest_non_spam_message_ts');

  /** The thread's subject, from its first message with one. */
  async subject(): Promise<string | undefined> {
    const { messages } = await this.detail.get();
    for (const m of messages) if (m.subject) return m.subject;
    return undefined;
  }

  /**
   * Everyone on the thread (senders and recipients), deduped by email.
   * Derived from the thread's first 100 messages.
   */
  async participants(): Promise<ApiContactInfo[]> {
    const { messages } = await this.detail.get();
    const seen = new Map<string, ApiContactInfo>();
    for (const m of messages) {
      for (const c of [m.from, ...m.to, ...m.cc, ...m.bcc]) {
        if (c && !seen.has(c.email)) seen.set(c.email, c);
      }
    }
    return [...seen.values()];
  }

  /** The messages in this thread, pre-seeded from the list endpoint. */
  async messages(opts?: {
    since?: string;
    limit?: number;
  }): Promise<EmailMessage[]> {
    const records = unwrap(
      await this.client.email.getThreadMessagesHandler({
        path: { id: this.id },
        query: {
          ...(opts?.since ? { since: opts.since } : {}),
          ...(opts?.limit ? { limit: opts.limit } : {}),
        },
      }),
    );
    return records.map((r) => EmailMessage.from(this.client, r));
  }

  /** The attachments across this thread's first 100 messages, pre-seeded from the thread detail. */
  async attachments(): Promise<EmailAttachment[]> {
    const { messages } = await this.detail.get();
    return messages.flatMap((m) =>
      m.attachments.map((a) => EmailAttachment.from(this.client, a)),
    );
  }

  /** Send a reply within this thread. Returns a handle when the API reports the created message's id. */
  async reply(opts: ReplyEmailOptions): Promise<EmailMessage | undefined> {
    const subject = opts.subject ?? (await this.subject()) ?? '';
    const { message } = await this.mutate((c) =>
      c.email.sendMessage({
        body: {
          message: {
            thread_db_id: this.id,
            replying_to_id: opts.replyingTo?.id ?? null,
            to: opts.to,
            cc: opts.cc ?? null,
            bcc: opts.bcc ?? null,
            subject,
            body_text: opts.bodyText,
          },
        },
      }),
    );
    return message.db_id
      ? EmailMessage.byId(this.client, message.db_id)
      : undefined;
  }

  /** Archive the thread (or unarchive with `false`). */
  async archive(archived = true): Promise<void> {
    await this.mutate((c) =>
      c.email.archiveThread({
        path: { id: this.id },
        body: { value: archived },
      }),
    );
  }

  /** Mark the thread as seen. */
  async markSeen(): Promise<void> {
    await this.mutate((c) => c.email.threadSeen({ path: { id: this.id } }));
  }

  /** Add a label to every message in the thread. */
  async addLabel(label: Label): Promise<void> {
    await this.mutate((c) =>
      c.email.addRemoveThreadLabel({
        path: { id: this.id },
        body: { label_id: label.id, value: true },
      }),
    );
  }

  /** Remove a label from every message in the thread. */
  async removeLabel(label: Label): Promise<void> {
    await this.mutate((c) =>
      c.email.addRemoveThreadLabel({
        path: { id: this.id },
        body: { label_id: label.id, value: false },
      }),
    );
  }

  /** Attach the thread to a project, or clear the project with `null`. */
  async moveToProject(project: Project | null): Promise<void> {
    await this.mutate((c) =>
      c.email.updateThreadProject({
        path: { thread_id: this.id },
        body: { projectId: project?.id ?? null },
      }),
    );
  }

  /** Search email threads by subject and content, most relevant first, auto-paginated. */
  static search = entitySearch({
    filters: { email_filters: {} },
    type: 'email',
    make: (client, hit) => new EmailThread(client, hit.thread_id),
  });
}
