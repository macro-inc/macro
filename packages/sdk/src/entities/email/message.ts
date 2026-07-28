import type {
  ApiDraftContactInfo,
  GetMessageResponses,
} from '../../../generated/email/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { MacroEntity } from '../entity';
import type { Label } from './label';
import { Link } from './link';
import { EmailThread } from './thread';

/** The API's representation of an email message (`ParsedMessage`). */
export type EmailMessageData = GetMessageResponses[200];

/** Options for sending a fresh email message. */
export interface SendEmailOptions {
  /** Recipients. */
  to: ApiDraftContactInfo[];
  /** Cc recipients. */
  cc?: ApiDraftContactInfo[];
  /** Bcc recipients. */
  bcc?: ApiDraftContactInfo[];
  /** Subject line. */
  subject: string;
  /** Plain-text body. */
  bodyText: string;
}

/**
 * A message in an email thread. A thin handle keyed by message id; the
 * record loads lazily on first field access.
 */
export class EmailMessage extends MacroEntity<EmailMessageData> {
  protected async fetch(): Promise<EmailMessageData> {
    return unwrap(
      await this.client.email.getMessage({ path: { id: this.id } }),
    );
  }

  /** A handle to a message by id. Fields load on first access. */
  static byId(client: MacroClient, id: string): EmailMessage {
    return new EmailMessage(client, id);
  }

  /** Build a message from an already-fetched record (pre-seeded, no fetch). */
  static from(client: MacroClient, data: EmailMessageData): EmailMessage {
    return new EmailMessage(client, data.db_id, data);
  }

  /** Send a new email message. Returns a handle when the API reports the created message's id. */
  static async send(
    client: MacroClient,
    opts: SendEmailOptions,
  ): Promise<EmailMessage | undefined> {
    const { message } = unwrap(
      await client.email.sendMessage({
        body: {
          message: {
            to: opts.to,
            cc: opts.cc ?? null,
            bcc: opts.bcc ?? null,
            subject: opts.subject,
            body_text: opts.bodyText,
          },
        },
      }),
    );
    return message.db_id ? EmailMessage.byId(client, message.db_id) : undefined;
  }

  /** The message's subject line. */
  readonly subject = this.field('subject');

  /** The sender. */
  readonly from = this.field('from');

  /** The To recipients. */
  readonly to = this.field('to');

  /** The Cc recipients. */
  readonly cc = this.field('cc');

  /** The Bcc recipients. */
  readonly bcc = this.field('bcc');

  /** The parsed message body, as the API returns it. */
  readonly body = this.field('body_parsed');

  /** The provider-internal date of the message. */
  readonly sentAt = this.field('internal_date_ts');

  /** Labels on this message. */
  readonly labels = this.field('labels');

  /** The inbox (email link) this message belongs to. */
  readonly link = this.mappedField('link_id', (id) =>
    Link.byId(this.client, id),
  );

  /** Add a label to this message. */
  async addLabel(label: Label): Promise<void> {
    await this.mutate((c) =>
      c.email.addRemoveLabel({
        body: {
          label_id: label.id,
          message_ids: [this.id],
          value: true,
        },
      }),
    );
  }

  /** Remove a label from this message. */
  async removeLabel(label: Label): Promise<void> {
    await this.mutate((c) =>
      c.email.addRemoveLabel({
        body: {
          label_id: label.id,
          message_ids: [this.id],
          value: false,
        },
      }),
    );
  }

  /** The thread this message belongs to. */
  async thread(): Promise<EmailThread> {
    return EmailThread.byId(
      this.client,
      (await this.detail.get()).thread_db_id,
    );
  }
}
