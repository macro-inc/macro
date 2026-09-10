import type { ItemMention } from '@core/component/LexicalMarkdown/plugins';
import type { Accessor } from 'solid-js';

/**
 * A comment from an external discussion source (CRM or PR).
 */
export interface DiscussionComment {
  /** Stable UUID. */
  id: string;
  /** Id of the thread this comment belongs to. */
  threadId: string;
  /** Resolved author id (`sender ?? owner`). */
  authorId: string;
  /** Comment body (markdown). */
  text: string;
  /** ISO creation timestamp. */
  createdAt: string;
  /** ISO last-updated timestamp. */
  updatedAt: string;
  /** ISO soft-delete timestamp, or null. */
  deletedAt: string | null;
}

/** A discussion thread with its comments, oldest-first. */
export interface DiscussionThread {
  /** Stable string thread id. */
  id: string;
  /** Whether the thread is resolved. */
  resolved: boolean;
  /** The thread's comments, pre-sorted oldest-first. */
  comments: DiscussionComment[];
}

/**
 * Backing data and actions for CRM/PR discussions. Native document and channel
 * conversations use the shared message queries and components directly.
 */
export interface DiscussionSource {
  /** Threads to render, oldest-first; each thread's comments pre-sorted. */
  threads: Accessor<DiscussionThread[]>;
  /** Whether the current user may create/edit/delete here. */
  canEdit: Accessor<boolean>;
  /** Current user id, for own-comment checks. */
  currentUserId: Accessor<string | undefined>;
  /** Comment id to highlight/scroll to (deep link), or null. */
  targetCommentId: Accessor<string | null>;
  /**
   * Optional revision for target requests. Increment when the same target id is
   * requested again so the UI can scroll again without replaying on remounts.
   */
  targetRevision?: Accessor<unknown>;
  /** Start a new thread. */
  createThread(text: string, mentions: ItemMention[]): Promise<void>;
  /** Reply to an existing thread. */
  createReply(
    threadId: string,
    text: string,
    mentions: ItemMention[]
  ): Promise<void>;
  /** Edit a comment's text. */
  editComment(comment: DiscussionComment, text: string): Promise<void>;
  /** Delete a comment. */
  deleteComment(comment: DiscussionComment): Promise<void>;
  /**
   * Build a shareable deep link to a comment. Omit it when the source has no
   * deep-linking yet — the copy-link affordance is then hidden.
   */
  buildCommentLink?(comment: DiscussionComment): string | undefined;
}
