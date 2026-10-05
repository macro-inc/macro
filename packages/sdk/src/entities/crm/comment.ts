import type {
  MessageCursor,
  MessageListItem,
  Message as MessageRecord,
  ThreadState,
} from '../../../generated/storage/types.gen';
import { type RichMessage, toBody } from '../../mentions';
import { mapConcurrently, paginate, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { MacroEntity } from '../entity';
import { User } from '../users/user';

/** The CRM record a discussion hangs off. */
export interface CrmCommentParent {
  type: 'crm_company' | 'crm_contact';
  id: string;
}

/** One of a CRM record's comment threads: its state and its comments. */
export interface CrmCommentThread {
  /** The thread state: root id, resolved flag, owner, timestamps. */
  thread: ThreadState;
  /** The thread's comments, root first, then replies oldest first. */
  comments: CrmComment[];
}

/** Thread reads in flight at once while a record's roots are expanded. */
const THREAD_FETCH_CONCURRENCY = 8;

/**
 * A comment on a CRM company or contact: a message whose parent is the
 * record, addressed by the record and the message UUID. Its record and
 * mutations are the ones document comments and channel messages use.
 */
export class CrmComment extends MacroEntity<MessageRecord> {
  private constructor(
    client: MacroClient,
    /** The company or contact this comment belongs to. */
    readonly parent: CrmCommentParent,
    id: string,
    seed?: MessageRecord,
  ) {
    super(client, id, seed);
  }

  private get path() {
    return {
      parent_type: this.parent.type,
      parent_id: this.parent.id,
      id: this.id,
    };
  }

  protected async fetch(): Promise<MessageRecord> {
    return unwrap(
      await this.client.storage.entityMessageGetMessage({ path: this.path }),
    );
  }

  /** A handle to a comment by id. Fields load on first access. */
  static byId(
    client: MacroClient,
    parent: CrmCommentParent,
    id: string,
  ): CrmComment {
    return new CrmComment(client, parent, id);
  }

  /** Build a comment from a message record (pre-seeded, no fetch). */
  static from(
    client: MacroClient,
    parent: CrmCommentParent,
    record: MessageRecord,
  ): CrmComment {
    return new CrmComment(client, parent, record.id, record);
  }

  /** The comment's text (markdown). */
  readonly text = this.field('content');

  /** When the comment was created. */
  readonly createdAt = this.field('created_at');

  /** When the comment was last updated. */
  readonly updatedAt = this.field('updated_at');

  /** When the comment was deleted, if it has been. */
  readonly deletedAt = this.field('deleted_at');

  /** The id of the thread this comment belongs to: its root, or itself for a root. */
  async threadId(): Promise<string> {
    return (await this.detail.get()).thread_id ?? this.id;
  }

  /** The user who wrote this comment. */
  async author(): Promise<User> {
    return User.byId(this.client, (await this.detail.get()).sender_id);
  }

  /** Reply in this comment's thread. */
  async reply(body: string | RichMessage): Promise<CrmComment> {
    return postCrmComment(this.client, this.parent, body, {
      threadId: await this.threadId(),
    });
  }

  /**
   * Replace the comment's text. Only its author may.
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

  /** Delete this comment. Deleting a thread's root keeps its replies. */
  async delete(): Promise<void> {
    await this.mutate((c) =>
      c.storage.entityMessageDeleteMessage({ path: this.path }),
    );
  }
}

/** A CRM record's live comment threads, each with its comments, newest thread first. */
export async function listCrmCommentThreads(
  client: MacroClient,
  parent: CrmCommentParent,
): Promise<CrmCommentThread[]> {
  const path = { parent_type: parent.type, parent_id: parent.id };
  const roots = paginate<MessageListItem, MessageCursor>(async (cursor) => {
    const page = unwrap(
      await client.storage.messageTimeline({
        path,
        query: { selection: JSON.stringify({ limit: 100, cursor }) },
      }),
    );
    return { items: page.items, nextCursor: page.next_cursor };
  });
  const items: MessageListItem[] = [];
  for await (const item of roots) items.push(item);
  return mapConcurrently(items, THREAD_FETCH_CONCURRENCY, async (item) => {
    const { state, root, replies } = unwrap(
      await client.storage.entityMessageGetThread({
        path: { ...path, id: item.id },
      }),
    );
    return {
      thread: state,
      comments: [root, ...replies].map((comment) =>
        CrmComment.from(client, parent, comment),
      ),
    };
  });
}

/**
 * Post a comment on a CRM record: a new thread, or a reply when `threadId`
 * (the thread's root comment id) is given.
 */
export async function postCrmComment(
  client: MacroClient,
  parent: CrmCommentParent,
  body: string | RichMessage,
  opts?: { threadId?: string },
): Promise<CrmComment> {
  const created = unwrap(
    await client.storage.entityMessageCreate({
      path: { parent_type: parent.type, parent_id: parent.id },
      body: { ...toBody(body), thread_id: opts?.threadId ?? null },
    }),
  );
  return CrmComment.from(client, parent, created);
}
