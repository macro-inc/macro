import type { Message as MessageRecord } from '../../../generated/storage/types.gen';
import { type RichMessage, toBody } from '../../mentions';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { MacroEntity } from '../entity';
import { User } from '../users/user';
import type { Document } from './document';

/**
 * A document message, addressed by its document and message UUID. Its record
 * and mutations are the same ones used for channel messages.
 */
export class Comment extends MacroEntity<MessageRecord> {
  private constructor(
    client: MacroClient,
    /** The document this comment belongs to. */
    readonly documentId: string,
    /** The comment's message UUID. */
    readonly commentId: string,
    seed?: MessageRecord,
  ) {
    super(client, commentId, seed);
  }

  protected async fetch(): Promise<MessageRecord> {
    return unwrap(
      await this.client.storage.entityMessageGetMessage({
        path: {
          parent_type: 'document',
          parent_id: this.documentId,
          id: this.id,
        },
      }),
    );
  }

  /** Build a comment from a comment-thread record (pre-seeded, no fetch). */
  static from(
    client: MacroClient,
    document: Document,
    record: MessageRecord,
  ): Comment {
    return new Comment(client, document.id, record.id, record);
  }

  /** The comment's text. */
  readonly text = this.field('content');

  /** The id of the thread this comment belongs to. */
  async threadId(): Promise<string> {
    return (await this.detail.get()).thread_id ?? this.id;
  }

  /** When the comment was created. */
  readonly createdAt = this.field('created_at');

  /** When the comment was last updated. */
  readonly updatedAt = this.field('updated_at');

  /** The user who wrote this comment. */
  async author(): Promise<User> {
    return User.byId(this.client, (await this.detail.get()).sender_id);
  }

  /** Replace the comment's text, with optional rich mentions. */
  async edit(body: string | RichMessage): Promise<this> {
    await this.mutate((c) =>
      c.storage.entityMessageEdit({
        path: {
          parent_type: 'document',
          parent_id: this.documentId,
          id: this.id,
        },
        body: toBody(body),
      }),
    );
    return this;
  }

  /** Delete this comment. */
  async delete(): Promise<void> {
    await this.mutate((c) =>
      c.storage.entityMessageDeleteMessage({
        path: {
          parent_type: 'document',
          parent_id: this.documentId,
          id: this.id,
        },
      }),
    );
  }
}
