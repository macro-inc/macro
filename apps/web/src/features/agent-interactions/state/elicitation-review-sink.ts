/**
 * The agent session's half of a user tool's composer: answering the review
 * elicitation the agent is blocked on.
 *
 * Accept sends the whole edited draft under the `draft` field (Macro's
 * `_macro/json` extension); the agent's finisher runs the tool with it.
 * Reject declines. The session has nowhere to keep an edit until the user
 * decides, so an edit in progress goes to `onEdit` only when the surface
 * keeps it itself: a card that can unmount while the review stays open.
 */

import type { UserToolReviewSink } from '@core/component/AI/component/tool/user-tool-review';
import type { ElicitationAnswer } from '@service-agent-harness/generated/schemas';
import type { Accessor } from 'solid-js';

/** The form field a Macro client sends the whole edited draft under. */
export const DRAFT_FIELD = 'draft';

export function createElicitationReviewSink<T>(options: {
  canAnswer: Accessor<boolean>;
  respond: (answer: ElicitationAnswer) => Promise<boolean>;
  /** Keep an edit in progress, so it outlives the composer. */
  onEdit?: (args: T) => void;
  /**
   * Why the composer is read-only, when the surface can say better than a
   * locked composer can: an answer on its way is no reason to say anything.
   */
  lockedNotice?: Accessor<string | undefined>;
}): UserToolReviewSink<T> {
  const canAct = () => options.canAnswer();
  return {
    canAct,
    lockedNotice:
      options.lockedNotice ??
      (() =>
        options.canAnswer() ? undefined : 'Waiting for an editor to answer.'),
    onEdit: options.onEdit,
    onExecute: (args) =>
      canAct()
        ? options.respond({
            action: 'accept',
            content: { [DRAFT_FIELD]: JSON.stringify(args) },
          })
        : Promise.resolve(false),
    onReject: () =>
      canAct()
        ? options.respond({ action: 'decline' })
        : Promise.resolve(false),
  };
}
