/**
 * The block's half of answering an elicitation: which question is live (the
 * fold's metadata slot), who may answer it, and the action that answers it.
 *
 * Not a queue. An answer is a response to a request the agent is blocked on,
 * so it goes straight out rather than behind queued prompts - and a second
 * answer to the same question is refused by the server (409), not merged.
 *
 * The answer rides the session's one optimistic path: {@link AgentSession}
 * speculates it into the fold before the POST, so the outcome on the part,
 * the turn leaving `blocked`, and the message's pending mark are the only
 * things a surface reads. There is no second "an answer is on the wire"
 * channel; only a refusal is surfaced after the fact.
 *
 * Anyone with edit access may answer - the same `EditAccessLevel` gate every
 * other control action has - so a surface shared with viewers (the session
 * split, a channel thread) reads {@link ElicitationController.canAnswer}
 * before offering a form, and says it is waiting on an editor otherwise.
 */

import type { IssueResult } from '@core/agent-session/AgentSession';
import { toast } from '@core/component/Toast/Toast';
import type { PendingElicitation } from '@service-agent-fold/generated/types';
import type {
  AgentAction,
  ElicitationAnswer,
} from '@service-agent-harness/generated/schemas';
import type { Accessor } from 'solid-js';

export type ElicitationController = {
  /** The question awaiting an answer right now, if any. */
  pending: Accessor<PendingElicitation | undefined>;
  /**
   * Whether the viewer may answer: edit access on the session. `false`
   * until the session has loaded.
   */
  canAnswer: Accessor<boolean>;
  /**
   * Answer the pending question. Resolves `true` when the service accepted
   * the answer; the fold has already shown it. A `409` means the agent is no
   * longer waiting (someone else answered, a stop cancelled it, or the
   * connection that asked is gone) - said once, and the retracted
   * speculation puts the form back where the metadata still has it. A viewer
   * without edit access gets `false` without a request.
   */
  respond: (answer: ElicitationAnswer) => Promise<boolean>;
};

export function createElicitationController(options: {
  pending: Accessor<PendingElicitation | undefined>;
  /** Whether the viewer may drive the session, once it has loaded. */
  canEdit: Accessor<boolean | undefined>;
  /** The session's one optimistic path; absent while there is no session. */
  issue: (action: AgentAction) => Promise<IssueResult> | undefined;
}): ElicitationController {
  const canAnswer = () => options.canEdit() === true;

  const respond = async (answer: ElicitationAnswer): Promise<boolean> => {
    const pending = options.pending();
    if (!pending || !canAnswer()) return false;
    try {
      const result = await options.issue({
        type: 'respondElicitation',
        requestId: pending.requestId,
        ...answer,
      });
      if (!result) return false;
      if (result.isErr()) {
        const conflict = result.error.some(
          (error) => error.code === 'CONFLICT'
        );
        toast.failure(
          conflict
            ? 'The agent is no longer waiting on that question'
            : "Couldn't send your answer"
        );
        return false;
      }
      return true;
    } catch {
      toast.failure("Couldn't send your answer");
      return false;
    }
  };

  return {
    pending: options.pending,
    canAnswer,
    respond,
  };
}
