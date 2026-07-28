import type {
  CrmComment as CrmCommentRecord,
  CrmThread,
  DeleteCrmCommentResult,
} from '../../../generated/storage/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';

/** A CRM comment thread with its comments, as returned for a company or contact. */
export interface CrmThreadWithComments {
  /** The thread. */
  thread: CrmThread;
  /** The thread's comments, oldest first. */
  comments: CrmComment[];
}

/**
 * A comment on a CRM company or contact. Shared by both entity types, since
 * the underlying API and record shape are already unified across them.
 */
export class CrmComment {
  private constructor(
    private readonly client: MacroClient,
    readonly id: string,
    private record: CrmCommentRecord,
  ) {}

  /** Wrap a record already in hand (e.g. from a list or create response). */
  static from(client: MacroClient, record: CrmCommentRecord): CrmComment {
    return new CrmComment(client, record.commentId, record);
  }

  /** The comment body (markdown). */
  get text(): string {
    return this.record.text;
  }

  /** The id of the thread this comment belongs to. */
  get threadId(): string {
    return this.record.threadId;
  }

  /** Macro user id of the comment author. */
  get owner(): string {
    return this.record.owner;
  }

  /** Macro user id of the actual sender, when distinct from {@link owner}. */
  get sender(): string | undefined {
    return this.record.sender ?? undefined;
  }

  /** Explicit ordering within the thread, if set. */
  get order(): number | undefined {
    return this.record.order ?? undefined;
  }

  /** Arbitrary client metadata attached to the comment. */
  get metadata(): unknown {
    return this.record.metadata;
  }

  /** When the comment was created. */
  get createdAt(): string {
    return this.record.createdAt;
  }

  /** When the comment was last updated. */
  get updatedAt(): string {
    return this.record.updatedAt;
  }

  /** When the comment was soft-deleted, if ever. */
  get deletedAt(): string | undefined {
    return this.record.deletedAt ?? undefined;
  }

  /** Replace this comment's text (markdown). */
  async edit(text: string): Promise<this> {
    this.record = unwrap(
      await this.client.storage.editCrmComment({
        path: { comment_id: this.id },
        body: { text },
      }),
    );
    return this;
  }

  /** Soft-delete this comment; the thread goes too when it was the last live one. */
  async delete(): Promise<DeleteCrmCommentResult> {
    return unwrap(
      await this.client.storage.deleteCrmComment({
        path: { comment_id: this.id },
      }),
    );
  }
}
