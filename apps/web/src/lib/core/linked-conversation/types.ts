import type { MessageData } from '@channel/Message/types';
import type { Accessor } from 'solid-js';

/**
 * A message in a linked conversation. Structurally the channel `Message`
 * primitive contract, so any plain object matching it renders — sources
 * backed by other systems adapt their records into this shape (see
 * `@core/comments/discussion/messageAdapter.ts` for the precedent).
 */
export type LinkedConversationMessage = MessageData;

/**
 * Backing data for a linked conversation, supplied per backend. The
 * presentational component is agnostic to which source backs it — this is the
 * seam that lets the same UI render channel threads today and other
 * conversation stores later. Read-only for now: contribution actions (reply,
 * react) will be added here when users can participate from the linked view.
 */
export interface LinkedConversationSource {
  /** Root message of the conversation, once loaded. */
  root: Accessor<LinkedConversationMessage | undefined>;
  /** Replies to the root, oldest-first. May be a preview subset — see {@link replyCount}. */
  replies: Accessor<LinkedConversationMessage[]>;
  /**
   * Total reply count when the source knows it ahead of a full load (e.g.
   * channel thread metadata). Falls back to `replies().length` when omitted.
   */
  replyCount?: Accessor<number | undefined>;
}
