/**
 * What a user tool's composer does with the user's decisions.
 *
 * A user tool (`SendEmail`, `CreateCalendarEvent`) is drafted by the agent
 * and finished by the user. The composer that edits the draft is the same
 * wherever it shows; what differs is who finishes the call: chat posts to the
 * cognition tool endpoints after the turn, an agent session answers the
 * agent's review elicitation mid-turn. Each surface builds one of these and
 * the composer calls it.
 */

import type { Accessor } from 'solid-js';

export type UserToolReviewSink<T> = {
  /** Whether this viewer may act: the chat's or session's owner. */
  canAct: Accessor<boolean>;
  /**
   * Why the composer is read-only when it is, in a sentence for the user -
   * "Only the chat owner can…", "Waiting for Alice to answer." - or nothing
   * when it is live.
   */
  lockedNotice: Accessor<string | undefined>;
  /**
   * An edit in progress. Chat persists these so a reload keeps them; a
   * session has nowhere to put them until submit, so it leaves this out.
   */
  onEdit?: (args: T) => void;
  /**
   * Execute the call with the edited arguments. Resolves `true` when the call
   * is finished (executed, or refused for good), `false` when the composer
   * should stay open for another try.
   */
  onExecute: (args: T) => Promise<boolean>;
  /** Reject the call. Same contract as {@link onExecute}. */
  onReject: () => Promise<boolean>;
  /** The composer is going away; flush or drop whatever is pending. */
  onDispose?: () => void;
};
