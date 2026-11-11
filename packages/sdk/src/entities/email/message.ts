import type {
  EmailRecipient,
  SendEmail,
  SendEmailResponse,
} from '../../../generated/agent-reviews';
import type {
  ApiDraftContactInfo,
  GetMessageResponses,
  MessageOperationResponse,
  ResolveMessageOperationRequest,
  TransferDraftRequest,
  TransferDraftResponse,
} from '../../../generated/email/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import type { Document } from '../documents/document';
import { MacroEntity } from '../entity';
import { EmailAttachment } from './attachment';
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

// The HTTP schema is opaque: the server serializes the Rust tool response,
// whose TypeScript contract is generated from the same Rust type.
function sendEmailResponse(response: unknown): SendEmailResponse {
  return response as SendEmailResponse;
}

/** An email the user has approved in conversation, for `email.sendConfirmed`. */
export interface ConfirmedEmailOptions {
  /** Recipients. */
  to: EmailRecipient[];
  /** Cc recipients. */
  cc?: EmailRecipient[];
  /** Bcc recipients. */
  bcc?: EmailRecipient[];
  /** Subject line. */
  subject: string;
  /** The body, written as Markdown; it is rendered to HTML on send. */
  body: string;
  /**
   * The connected inbox to send from. Omit it unless you know which inbox is
   * right: a reply then goes out from the inbox that received the message it
   * answers, and a new email from the user's primary inbox.
   */
  from?: Link;
  /** The message this answers; the email is then sent as a reply in its thread. */
  replyingTo?: EmailMessage;
  /**
   * Macro documents to attach as files: uploaded files (PDFs, images,
   * spreadsheets, Word documents) the user can view, 18 MB together. An
   * editor-native document has no file; link to it in the body instead.
   */
  attachments?: Document[];
  /** `false` leaves the inbox signature off this one email; omit for the inbox's default. */
  includeSignature?: boolean;
  /**
   * The user's own reply approving this specific email, quoted verbatim, such
   * as their "yes, send it" after you wrote the email out for them. Never the
   * request that asked you to write it, and never your own words.
   */
  userConfirmation: string;
}

/** A forward the user has approved, for `EmailMessage.forwardDraft` and `forwardConfirmed`. */
export interface ForwardEmailOptions {
  /** Recipients. */
  to: EmailRecipient[];
  /** Cc recipients. */
  cc?: EmailRecipient[];
  /** Bcc recipients. */
  bcc?: EmailRecipient[];
  /** A note above the forwarded message, written as Markdown. */
  body?: string;
  /** The connected inbox to send from; defaults to the inbox holding the message. */
  from?: Link;
  /** `false` leaves the inbox signature off this one email; omit for the inbox's default. */
  includeSignature?: boolean;
}

/** The first line of a forwarded message, as the web composer writes it. */
const FORWARDED_MESSAGE_HEADER = '---------- Forwarded message ----------';

/** Escape text so Markdown renders it literally. */
function literalMarkdown(text: string): string {
  return text.replace(/[\\`*_{}[\]<>()#+\-.!|~]/g, '\\$&');
}

/** A sent email: the message and the thread it belongs to. */
export interface SentEmail {
  /** The sent message. */
  message: EmailMessage;
  /** The thread the message belongs to. */
  thread: EmailThread;
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

  /**
   * Send a new plain-text email; an agent's program is refused (403) and
   * sends through a review or {@link EmailMessage.sendConfirmed} instead.
   * Returns a handle when the API reports the created message's id.
   */
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

  /** Send an email the user approved in conversation, quoting their approval; see `EmailNamespace.sendConfirmed`. */
  static async sendConfirmed(
    client: MacroClient,
    opts: ConfirmedEmailOptions,
  ): Promise<SentEmail> {
    const email: SendEmail = {
      subject: opts.subject,
      body: opts.body,
      to: opts.to,
      cc: opts.cc,
      bcc: opts.bcc,
      from: opts.from ? await opts.from.emailAddress() : undefined,
      replyingToId: opts.replyingTo?.id,
      includeSignature: opts.includeSignature,
      attachments: opts.attachments?.map((document) => ({
        documentId: document.id,
      })),
    };
    return EmailMessage.sendReviewedDraft(client, email, opts.userConfirmation);
  }

  /** @internal Run the SendConfirmedEmail tool with a SendEmail draft and its approval. */
  private static async sendReviewedDraft(
    client: MacroClient,
    email: SendEmail,
    userConfirmation: string,
  ): Promise<SentEmail> {
    const response = sendEmailResponse(
      unwrap(
        await client.cognition.sendConfirmedEmail({
          body: { ...email, userConfirmation },
        }),
      ),
    );
    if (typeof response === 'string' || !response.sent)
      throw new Error('The confirmed send did not report a sent message');
    return {
      message: EmailMessage.byId(client, response.sent.message_id),
      thread: EmailThread.byId(client, response.sent.thread_id),
    };
  }

  /**
   * The files attached to this message, from its thread's first 100 messages.
   *
   * @readonly
   */
  async attachments(): Promise<EmailAttachment[]> {
    const { thread_db_id } = await this.detail.get();
    const { thread } = unwrap(
      await this.client.email.getThread({
        path: { thread_id: thread_db_id },
        query: { limit: 100 },
      }),
    );
    const message = thread.messages.find((m) => m.db_id === this.id);
    if (!message)
      throw new Error(
        `Message ${this.id} is not among its thread's first 100 messages`,
      );
    return message.attachments.map((a) => EmailAttachment.from(this.client, a));
  }

  /**
   * This message as a forward: a SendEmail draft with the note, the quoted
   * message under the forwarded-message header, and its attachments as
   * Macro documents. Pass it to `execution.reviews.create({kind: 'email'})`
   * in a session; in a thread, use {@link forwardConfirmed}.
   *
   * @write
   * @idempotent
   */
  async forwardDraft(opts: ForwardEmailOptions): Promise<SendEmail> {
    const [message, attachments] = await Promise.all([
      this.detail.get(),
      this.attachments(),
    ]);
    const documents = await Promise.all(
      attachments.map((attachment) => attachment.toDocument()),
    );
    const inbox = opts.from ?? Link.byId(this.client, message.link_id);
    const subject = message.subject ?? '';
    const people = (contacts: EmailMessageData['to']) =>
      contacts
        .map((contact) => `${contact.name ?? contact.email} <${contact.email}>`)
        .join(', ');
    const header = [
      FORWARDED_MESSAGE_HEADER,
      `From: ${message.from ? people([message.from]) : ''}`,
      `Date: ${message.internal_date_ts ? new Date(message.internal_date_ts).toUTCString() : ''}`,
      `Subject: ${subject}`,
      ...(message.to.length > 0 ? [`To: ${people(message.to)}`] : []),
      ...(message.cc.length > 0 ? [`Cc: ${people(message.cc)}`] : []),
    ];
    const quoted = (message.body_parsed ?? '')
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => `> ${literalMarkdown(line)}`)
      .join('\n>\n');
    return {
      subject: /^fwd?:/i.test(subject) ? subject : `Fwd: ${subject}`,
      body: [
        ...(opts.body ? [opts.body] : []),
        header.map(literalMarkdown).join('\n\n'),
        quoted,
      ]
        .filter((part) => part !== '')
        .join('\n\n'),
      to: opts.to,
      cc: opts.cc,
      bcc: opts.bcc,
      from: await inbox.emailAddress(),
      includeSignature: opts.includeSignature,
      attachments: documents.map((document) => ({ documentId: document.id })),
    };
  }

  /**
   * Forward this message, with its attachments, only after the user replied approving the forward, quoting that reply in `userConfirmation`.
   *
   * For a prompt from a channel or document thread: write the forward out
   * (recipients and note), ask whether to send it, and call this in a later
   * turn on the user's approving reply. In the agent session view, present
   * `forwardDraft` as a review instead. The forward is a new email that
   * quotes this message and carries its attachments; it takes effect at once
   * and is never retried.
   *
   * @destructive
   * @openworld
   */
  async forwardConfirmed(
    opts: ForwardEmailOptions & { userConfirmation: string },
  ): Promise<SentEmail> {
    return EmailMessage.sendReviewedDraft(
      this.client,
      await this.forwardDraft(opts),
      opts.userConfirmation,
    );
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

  /**
   * Read the draft's durable send, upload, or conflict status without retrying it.
   *
   * @readonly
   */
  async operationStatus(): Promise<MessageOperationResponse> {
    return unwrap(
      await this.client.email.messageOperationStatus({ path: { id: this.id } }),
    );
  }

  /** Resolve the displayed operation revision after the user chooses an action.
   * Retrying an uncertain send requires explicit duplicate-risk acceptance.
   *
   * @destructive
   * @openworld
   */
  async resolveOperation(
    request: ResolveMessageOperationRequest,
  ): Promise<void> {
    await this.mutate((c) =>
      c.email.resolveMessageOperation({ path: { id: this.id }, body: request }),
    );
  }

  /**
   * Verify an uploaded attachment using the draft generation captured when its upload began.
   *
   * @write
   * @idempotent
   */
  async completeDraftAttachment(
    attachmentId: string,
    draftGeneration = 0,
  ): Promise<void> {
    const link = await this.link();
    await this.mutate((c) =>
      c.email.completeDraftAttachment({
        path: { id: this.id, attachment_id: attachmentId },
        query: { draft_generation: draftGeneration },
        headers: { 'X-Email-Link-Id': link.id },
      }),
    );
  }

  /** Move a draft to another inbox using a caller-persisted operation UUID.
   * Continue editing the returned message_id; the original identity is retired.
   * On an interrupted response, use email.recoverDraftTransfer(operation_id).
   *
   * @write
   * @openworld
   * @idempotent
   */
  async transferDraft(
    request: TransferDraftRequest,
  ): Promise<TransferDraftResponse> {
    const draft = await this.detail.get();
    return this.mutate((c) =>
      c.email.transferDraft({
        path: { id: this.id },
        body: {
          ...request,
          draft_generation:
            request.draft_generation ?? draft.draft_generation ?? 0,
        },
        headers: { 'X-Email-Link-Id': draft.link_id },
      }),
    );
  }

  /**
   * Add a label to this message.
   *
   * @write
   * @openworld
   * @idempotent
   */
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

  /**
   * Remove a label from this message.
   *
   * @write
   * @openworld
   * @idempotent
   */
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

  /**
   * The thread this message belongs to.
   *
   * @readonly
   */
  async thread(): Promise<EmailThread> {
    return EmailThread.byId(
      this.client,
      (await this.detail.get()).thread_db_id,
    );
  }

  /**
   * The message's original source, exactly as Gmail or Outlook holds it, as
   * `message/rfc822` bytes for an `.eml` file. Drafts and messages still on
   * their way have no source yet and fail with a 404.
   *
   * @readonly
   * @mcp-exclude Returns raw bytes only; MCP calls carry JSON.
   */
  async downloadEml(): Promise<Blob> {
    return unwrap(
      await this.client.email.getMessageEml({
        path: { id: this.id },
        parseAs: 'blob',
      }),
    );
  }
}
