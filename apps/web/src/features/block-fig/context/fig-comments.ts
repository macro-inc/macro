/**
 * Where a design's comments live, injected by the block (document
 * discussions in the app, an in-memory store in the browser fixture), so
 * the viewer's comment UI has no app dependencies.
 */

import type { Accessor } from 'solid-js';
import type {
  FigCommentAnchor,
  FigCommentThread,
  FigPerson,
} from '../core/comments';

export interface FigCommentStore {
  /** Every thread on the design, as it is now. */
  threads: Accessor<FigCommentThread[]>;
  /** The person commenting; `undefined` when not signed in. */
  me: Accessor<FigPerson | undefined>;
  /** Whether this person may post, reply, and resolve. */
  canComment: Accessor<boolean>;
  /** When this person last read a thread (ms), for unread badges. */
  seenAt: (threadId: string) => number | undefined;
  markSeen: (threadId: string) => void;
  /** Starts a thread; resolves to its id. */
  create: (
    anchor: FigCommentAnchor,
    text: string,
    mentions: FigPerson[]
  ) => Promise<string>;
  reply: (
    threadId: string,
    text: string,
    mentions: FigPerson[]
  ) => Promise<void>;
  setResolved: (threadId: string, resolved: boolean) => Promise<void>;
  deleteThread: (threadId: string) => Promise<void>;
  /** Loads every reply of a thread (lists may hold only the first few). */
  load?: (threadId: string) => void;
  /** People who can be mentioned, matching `query`. */
  people: (query: string) => FigPerson[];
}
