import type { ExternalChatUploadedAttachment } from '../../../generated/storage/types.gen';
import type { ExternalChat } from './chat';

/** A staged attachment scoped to one added chat; use it in a deliberate media send. */
export class ExternalChatUpload {
  private constructor(
    /** Correlation identity of the staged upload. */
    readonly id: string,
    /** The chat this upload can be sent to. */
    readonly chat: ExternalChat,
    /** Display filename supplied by the server. */
    readonly filename?: string,
    /** Media category supplied by the server. */
    readonly kind?: ExternalChatUploadedAttachment['kind'],
  ) {}

  /** Reference a previously staged upload in its original chat. */
  static byId(chat: ExternalChat, id: string): ExternalChatUpload {
    return new ExternalChatUpload(id, chat);
  }

  /** Seed a handle from the server's upload receipt. */
  static from(
    chat: ExternalChat,
    record: ExternalChatUploadedAttachment,
  ): ExternalChatUpload {
    return new ExternalChatUpload(
      record.uploadId,
      chat,
      record.filename,
      record.kind,
    );
  }

  /** Serialize the upload reference without credentials. */
  toJSON() {
    return {
      id: this.id,
      chat: this.chat.id,
      filename: this.filename,
      kind: this.kind,
    };
  }
}
