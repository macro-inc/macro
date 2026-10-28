import type { Message as MessageRecord } from '../../../generated/storage/types.gen';
import { type RichMessage, toBody } from '../../mentions';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { MacroEntity } from '../entity';
import { User } from '../users/user';
import { Document } from './document';

/**
 * A comment on a document: a document-parent message, addressed by its
 * document and message UUID. Its record and mutations are the ones channel
 * messages use.
 */
export class Comment extends MacroEntity<MessageRecord> {
  private constructor(
    client: MacroClient,
    /** The document this comment belongs to. */
    readonly documentId: string,
    id: string,
    seed?: MessageRecord,
  ) {
    super(client, id, seed);
  }

  private get path() {
    return { parent_type: 'document', parent_id: this.documentId, id: this.id };
  }

  protected async fetch(): Promise<MessageRecord> {
    return unwrap(
      await this.client.storage.entityMessageGetMessage({ path: this.path }),
    );
  }

  /** A handle to a comment by id. Fields load on first access. */
  static byId(client: MacroClient, documentId: string, id: string): Comment {
    return new Comment(client, documentId, id);
  }

  /** Build a comment from a message record (pre-seeded, no fetch). */
  static from(
    client: MacroClient,
    documentId: string,
    record: MessageRecord,
  ): Comment {
    return new Comment(client, documentId, record.id, record);
  }

  /** The comment's text. */
  readonly text = this.field('content');

  /** When the comment was created. */
  readonly createdAt = this.field('created_at');

  /** When the comment was last updated. */
  readonly updatedAt = this.field('updated_at');

  /** The id of the thread this comment belongs to: its root, or itself for a root. */
  async threadId(): Promise<string> {
    return (await this.detail.get()).thread_id ?? this.id;
  }

  /** The document this comment is on. */
  document(): Document {
    return Document.byId(this.client, this.documentId);
  }

  /** The user who wrote this comment. */
  async author(): Promise<User> {
    return User.byId(this.client, (await this.detail.get()).sender_id);
  }

  /** Reply in this comment's thread. */
  async reply(body: string | RichMessage): Promise<Comment> {
    return this.document().comment(body, { threadId: await this.threadId() });
  }

  /**
   * Replace the comment's text.
   *
   * @param body - Plain text, or a rich body composed with {@link msg}.
   */
  async edit(body: string | RichMessage): Promise<this> {
    const { content, mentions } = toBody(body);
    await this.mutate((c) =>
      c.storage.entityMessageEdit({
        path: this.path,
        body: { content, mentions },
      }),
    );
    return this;
  }

  /** Delete this comment. */
  async delete(): Promise<void> {
    await this.mutate((c) =>
      c.storage.entityMessageDeleteMessage({ path: this.path }),
    );
  }
}
