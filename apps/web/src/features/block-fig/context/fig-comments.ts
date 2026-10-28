/**
 * Where a design's comments live and how they are written and shown,
 * injected by the block (Macro comments in the app, an in-memory store in
 * the browser fixture), so the viewer's comment tool has no app
 * dependencies. The viewer owns the pins, the thread list, and where a
 * thread opens; the store supplies the thread and composer inside them.
 */

import type { Accessor, Component } from 'solid-js';
import type {
  FigCommentAnchor,
  FigCommentThread,
  FigPerson,
} from '../core/comments';

export interface FigCommentComposerProps {
  /** Where the new thread pins. */
  anchor: FigCommentAnchor;
  /** The thread was posted; it opens beside its pin. */
  onPosted: (threadId: string) => void;
  /** The composer was closed without posting. */
  onCancel: () => void;
}

export interface FigCommentStore {
  /** Every thread pinned on the design, as it is now. */
  threads: Accessor<FigCommentThread[]>;
  /** The person commenting; `undefined` when not signed in. */
  me: Accessor<FigPerson | undefined>;
  /** Whether this person may post, reply, and resolve. */
  canComment: Accessor<boolean>;
  /** When this person last read a thread (ms), for unread badges. */
  seenAt: (threadId: string) => number | undefined;
  markSeen: (threadId: string) => void;
  setResolved: (threadId: string, resolved: boolean) => Promise<void>;
  /** A thread's comments with their replies and the reply box. */
  Thread: Component<{ threadId: string }>;
  /** The box that starts a thread. */
  Composer: Component<FigCommentComposerProps>;
  /** Comments on the whole design (pinned nowhere), below the list. */
  Discussion?: Component;
  /**
   * The comment a link opened: its pinned thread, or `null` for one in the
   * discussion. A new value each time a link is followed.
   */
  linked?: Accessor<{ threadId: string | null } | undefined>;
}
