import type { Comment as CommentRecord } from '../../../generated/storage/types.gen';
import { MacroNotFoundError, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { MacroEntity } from '../entity';
import { User } from '../users/user';
import type { Document } from './document';

/**
 * A comment on a document. Compound-keyed by `(documentId, commentId)`:
 * comment ids are numeric and only unique per document, so the numeric id is
 * kept as {@link commentId} and its string form backs the base class `id`.
 */
export class Comment extends MacroEntity<CommentRecord> {
  private constructor(
    client: MacroClient,
    /** The document this comment belongs to. */
    readonly documentId: string,
    /** The comment's numeric id, as the API uses it. */
    readonly commentId: number,
    seed?: CommentRecord,
  ) {
    super(client, String(commentId), seed);
  }

  /**
   * There is no single-comment GET, so a fetch loads the document's comment
   * threads and finds this comment in them.
   */
  protected async fetch(): Promise<CommentRecord> {
    const { data } = unwrap(
      await this.client.storage.getDocumentComments({
        path: { document_id: this.documentId },
      }),
    );
    for (const thread of data) {
      const found = thread.comments.find((c) => c.commentId === this.commentId);
      if (found) return found;
    }
    throw new MacroNotFoundError(
      `comment ${this.commentId} not found on document ${this.documentId}`,
    );
  }

  /** Build a comment from a comment-thread record (pre-seeded, no fetch). */
  static from(
    client: MacroClient,
    document: Document,
    record: CommentRecord,
  ): Comment {
    return new Comment(client, document.id, record.commentId, record);
  }

  /** The comment's text. */
  readonly text = this.field('text');

  /** The id of the thread this comment belongs to. */
  readonly threadId = this.field('threadId');

  /** When the comment was created. */
  readonly createdAt = this.field('createdAt');

  /** When the comment was last updated. */
  readonly updatedAt = this.field('updatedAt');

  /** The user who wrote this comment. */
  async author(): Promise<User> {
    return User.byId(this.client, (await this.detail.get()).owner);
  }

  /**
   * Replace the comment's text. The endpoint requires the thread id in the
   * body, which is resolved from the comment's own record.
   */
  async edit(text: string): Promise<this> {
    const { threadId } = await this.detail.get();
    await this.mutate((c) =>
      c.storage.editComment({
        path: { comment_id: this.commentId },
        body: { text, threadId },
      }),
    );
    return this;
  }

  /** Delete this comment. */
  async delete(): Promise<void> {
    await this.mutate((c) =>
      c.storage.deleteComment({
        path: { comment_id: this.commentId },
        body: {},
      }),
    );
  }
}
