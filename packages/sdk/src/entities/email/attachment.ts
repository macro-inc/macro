import type { GetAttachmentResponses } from '../../../generated/email/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { Document } from '../documents/document';
import { MacroEntity } from '../entity';

/** The API's representation of an email attachment (`Attachment`). */
export type EmailAttachmentData = GetAttachmentResponses[200]['attachment'];

/**
 * A file attached to an email message. A thin handle keyed by attachment id;
 * the record loads lazily on first field access.
 */
export class EmailAttachment extends MacroEntity<EmailAttachmentData> {
  protected async fetch(): Promise<EmailAttachmentData> {
    const { attachment } = unwrap(
      await this.client.email.getAttachment({ path: { id: this.id } }),
    );
    return attachment;
  }

  /** A handle to an attachment by id. Fields load on first access. */
  static byId(client: MacroClient, id: string): EmailAttachment {
    return new EmailAttachment(client, id);
  }

  /** Build an attachment from an already-fetched record (pre-seeded, no fetch). */
  static from(client: MacroClient, data: EmailAttachmentData): EmailAttachment {
    return new EmailAttachment(client, data.db_id, data);
  }

  /** The attachment's original filename. */
  readonly filename = this.field('filename');

  /** The attachment's MIME type. */
  readonly mimeType = this.field('mime_type');

  /** The attachment's size in bytes. */
  readonly size = this.field('size_bytes');

  /** A URL to the attachment's raw data, when available. */
  readonly dataUrl = this.field('data_url');

  /** The attachment's static-file-service id, when it has been stored there. */
  readonly sfsId = this.field('sfs_id');

  /** The attachment's Content-ID header value (for inline attachments). */
  readonly contentId = this.field('content_id');

  /**
   * The Macro document holding this attachment's content. Get-or-create: the
   * server returns the existing document's id, or downloads the attachment
   * from the provider and uploads it as a new document first (deduplicated
   * behind a server-side lock).
   */
  async toDocument(): Promise<Document> {
    const { document_id } = unwrap(
      await this.client.email.getAttachmentDocumentId({
        path: { id: this.id },
      }),
    );
    return Document.byId(this.client, document_id);
  }
}
