/**
 * The agent session's half of a user tool's composer: answering the review
 * elicitation the agent is blocked on.
 *
 * Accept sends the whole edited draft under the `draft` field (Macro's
 * `_macro/json` extension); the agent's finisher runs the tool with it.
 * Reject declines. There is nothing to persist between edits - the draft
 * lives in the form until the user decides - so `onEdit` is left out.
 */

import type { UserToolReviewSink } from '@core/component/AI/component/tool/user-tool-review';
import type { ElicitationAnswer } from '@service-agent-harness/generated/schemas';
import type { Accessor } from 'solid-js';

/** The form field a Macro client sends the whole edited draft under. */
export const DRAFT_FIELD = 'draft';

export function createElicitationReviewSink<T>(options: {
  canAnswer: Accessor<boolean>;
  ownerName: Accessor<string>;
  answering: Accessor<boolean>;
  respond: (answer: ElicitationAnswer) => Promise<boolean>;
}): UserToolReviewSink<T> {
  const canAct = () => options.canAnswer() && !options.answering();
  return {
    canAct,
    lockedNotice: () =>
      options.canAnswer()
        ? undefined
        : `Waiting for ${options.ownerName()} to answer.`,
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
