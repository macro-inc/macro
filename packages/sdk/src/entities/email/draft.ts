import type {
  AddDraftAttachmentRequest,
  ApiDraftInput,
} from '../../../generated/email/types.gen';
import type { MacroClient } from '../../utils/client';
import type { EmailAttachment } from './attachment';
import { EmailMessage } from './message';
import type { EmailThread } from './thread';

/** Draft content; relationships use message and thread handles. */
export type DraftOptions = Omit<
  ApiDraftInput,
  | 'db_id'
  | 'provider_id'
  | 'provider_thread_id'
  | 'replying_to_id'
  | 'thread_db_id'
  | 'body_text'
  | 'body_html'
  | 'body_macro'
  | 'headers_json'
  | 'include_signature'
  | 'draft_generation'
> & {
  /** Generation captured when editing began; defaults to the loaded draft. */
  draftGeneration?: number;
  /** Plain text body. */
  bodyText?: string;
  /** HTML body. */
  bodyHtml?: string;
  /** Macro body. */
  bodyMacro?: string;
  /** Extra headers. */
  headers?: ApiDraftInput['headers_json'];
  /** Include the inbox signature. */
  includeSignature?: boolean;
  /** Thread receiving this draft. */
  thread?: EmailThread;
  /** Message being replied to. */
  replyingTo?: EmailMessage;
};

/** A draft email. Sending remains an explicit separate operation. */
export class EmailDraft extends EmailMessage {
  private async draftContext() {
    const draft = await this.detail.get();
    return {
      headers: { 'X-Email-Link-Id': draft.link_id },
      query: { draft_generation: draft.draft_generation ?? 0 },
    };
  }

  /** Construct a lazy draft handle. */
  static byId(client: MacroClient, id: string): EmailDraft {
    return new EmailDraft(client, id);
  }

  /** Edit generation to capture with content before saving or transferring it. */
  readonly draftGeneration = this.field('draft_generation');

  /** Replace draft content without changing its identity or sending it. */
  async update(options: DraftOptions): Promise<void> {
    const { headers, query } = await this.draftContext();
    await this.mutate((c) =>
      c.email.createDraft({
        headers,
        body: {
          draft: {
            ...draftBody(options),
            db_id: this.id,
            draft_generation: options.draftGeneration ?? query.draft_generation,
          },
        },
      }),
    );
  }

  /** Delete the draft. */
  async delete(): Promise<void> {
    const { headers, query } = await this.draftContext();
    await this.mutate((c) =>
      c.email.deleteDraft({ path: { id: this.id }, headers, query }),
    );
  }

  /** Schedule this draft for sending. */
  async schedule(
    sendTime: string,
    options?: { includeSignature?: boolean },
  ): Promise<void> {
    const { headers, query } = await this.draftContext();
    await this.mutate((c) =>
      c.email.upsertScheduledMessage({
        path: { id: this.id },
        headers,
        query,
        body: {
          send_time: sendTime,
          include_signature: options?.includeSignature,
        },
      }),
    );
  }

  /** Remove a scheduled send. */
  async unschedule(): Promise<void> {
    const { headers, query } = await this.draftContext();
    await this.mutate((c) =>
      c.email.deleteScheduledDraft({
        path: { message_id: this.id },
        headers,
        query,
      }),
    );
  }

  /** Reserve an attachment upload. Upload to the returned URL, then call complete(). */
  async addAttachment(options: {
    fileName: string;
    sha: string;
    size: number;
    uploadId?: string;
  }) {
    const body: AddDraftAttachmentRequest = {
      file_name: options.fileName,
      sha: options.sha,
      size: options.size,
      upload_id: options.uploadId,
    };
    const { headers, query } = await this.draftContext();
    const result = await this.mutate((c) =>
      c.email.addDraftAttachment({
        path: { id: this.id },
        headers,
        query,
        body,
      }),
    );
    return {
      attachment: DraftAttachment.byId(
        this.client,
        this,
        result.attachment_id,
        false,
        query.draft_generation,
      ),
      uploadUrl: result.upload_url,
      contentType: result.content_type,
    };
  }

  /** Forward an existing attachment into this draft. */
  async forwardAttachment(
    attachment: EmailAttachment,
  ): Promise<DraftAttachment> {
    const { headers, query } = await this.draftContext();
    const result = await this.mutate((c) =>
      c.email.addForwardedAttachment({
        path: { id: this.id },
        headers,
        query,
        body: { attachment_id: attachment.id },
      }),
    );
    return DraftAttachment.byId(
      this.client,
      this,
      result.attachment_id,
      true,
      query.draft_generation,
    );
  }

  /** Remove a draft attachment. */
  async removeAttachment(attachment: DraftAttachment): Promise<void> {
    if (attachment.draft.id !== this.id)
      throw new Error('Attachment belongs to another draft');
    const { headers } = await this.draftContext();
    const query = { draft_generation: attachment.draftGeneration };
    if (attachment.forwarded)
      await this.mutate((c) =>
        c.email.removeForwardedAttachment({
          path: { id: this.id, attachment_id: attachment.id },
          headers,
          query,
        }),
      );
    else
      await this.mutate((c) =>
        c.email.removeDraftAttachment({
          path: { id: this.id, attachment_id: attachment.id },
          headers,
          query,
        }),
      );
  }

  /** Complete verification of an uploaded attachment. */
  async verifyAttachment(attachment: DraftAttachment): Promise<void> {
    if (attachment.draft.id !== this.id || attachment.forwarded)
      throw new Error('Expected an uploaded attachment on this draft');
    await this.completeDraftAttachment(
      attachment.id,
      attachment.draftGeneration,
    );
  }
}

/** An uploaded or forwarded attachment belonging to a draft. */
export class DraftAttachment {
  private constructor(
    /** Parent draft. */
    readonly draft: EmailDraft,
    /** Attachment identity. */
    readonly id: string,
    /** Whether this attachment was forwarded. */
    readonly forwarded: boolean,
    /** Draft generation captured when the attachment was reserved. */
    readonly draftGeneration: number,
  ) {}

  /** Construct a draft scoped attachment handle. */
  static byId(
    _client: MacroClient,
    draft: EmailDraft,
    id: string,
    forwarded = false,
    draftGeneration = 0,
  ): DraftAttachment {
    return new DraftAttachment(draft, id, forwarded, draftGeneration);
  }

  /** Complete verification after uploading the file. */
  complete(): Promise<void> {
    return this.draft.verifyAttachment(this);
  }

  /** Remove this attachment from its draft. */
  remove(): Promise<void> {
    return this.draft.removeAttachment(this);
  }

  /** Serialize identity without credentials. */
  toJSON() {
    return {
      id: this.id,
      draftId: this.draft.id,
      forwarded: this.forwarded,
      draftGeneration: this.draftGeneration,
    };
  }
}

/** Translate draft content to the generated contract. */
export function draftBody(options: DraftOptions): ApiDraftInput {
  const {
    bodyText,
    bodyHtml,
    bodyMacro,
    headers,
    includeSignature,
    draftGeneration,
    thread,
    replyingTo,
    ...rest
  } = options;
  return {
    ...rest,
    body_text: bodyText,
    body_html:
      bodyHtml === undefined
        ? undefined
        : btoa(
            Array.from(new TextEncoder().encode(bodyHtml), (byte) =>
              String.fromCharCode(byte),
            ).join(''),
          )
            .replaceAll('+', '-')
            .replaceAll('/', '_')
            .replaceAll('=', ''),
    body_macro: bodyMacro,
    headers_json: headers,
    include_signature: includeSignature,
    draft_generation: draftGeneration,
    thread_db_id: thread?.id,
    replying_to_id: replyingTo?.id,
  };
}
