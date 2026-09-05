import type { InputSnapshot } from '@channel/Input/types';
import type { MessageData } from '@channel/Message/types';
import type { ItemMention } from '@core/component/LexicalMarkdown/plugins';
import type { Accessor } from 'solid-js';

/**
 * A single comment within a discussion thread, normalized across backends.
 * Messages and CRM records both have UUID identities.
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
  /** Imported author attribution, separate from the authenticated owner. */
  importedAuthor?: string;
  attachments?: MessageData['attachments'];
  reactions?: MessageData['reactions'];
}

/** A discussion thread with its comments, oldest-first. */
export interface DiscussionThread {
  /** Stable string thread id. */
  id: string;
  /** Whether the thread is resolved. */
  resolved: boolean;
  ownerId?: string;
  /** The thread's comments, pre-sorted oldest-first. */
  comments: DiscussionComment[];
}

/**
 * Backing data + actions for a discussion, supplied per entity kind
 * (document/task, CRM company/contact). The presentational components are
 * agnostic to which source backs them — this is the seam that lets the same
 * discussion UI render document and CRM comments.
 */
export interface DiscussionSource {
  /** Threads to render, oldest-first; each thread's comments pre-sorted. */
  threads: Accessor<DiscussionThread[]>;
  attachmentMode?: 'files' | 'inline-images';
  isLoading?: Accessor<boolean>;
  error?: Accessor<string | null>;
  retry?: () => void;
  canDeleteThread?: (thread: DiscussionThread) => boolean;
  typing?: (threadId: string, active: boolean) => void;
  typingUsers?: (threadId: string) => string[];
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
  createThread(
    text: string,
    mentions: ItemMention[],
    attachments?: InputSnapshot['attachments']
  ): Promise<void>;
  /** Reply to an existing thread. */
  createReply(
    threadId: string,
    text: string,
    mentions: ItemMention[],
    attachments?: InputSnapshot['attachments']
  ): Promise<void>;
  /** Edit a comment's text. */
  editComment(
    comment: DiscussionComment,
    text: string,
    mentions?: ItemMention[],
    attachments?: InputSnapshot['attachments']
  ): Promise<void>;
  /** Delete a comment. */
  deleteComment(comment: DiscussionComment): Promise<void>;
  react?(comment: DiscussionComment, emoji: string): Promise<void>;
  resolveThread?(threadId: string, resolved: boolean): Promise<void>;
  deleteThread?(threadId: string): Promise<void>;
  /**
   * Build a shareable deep link to a comment. Omit it when the source has no
   * deep-linking yet — the copy-link affordance is then hidden.
   */
  buildCommentLink?(comment: DiscussionComment): string;
}
