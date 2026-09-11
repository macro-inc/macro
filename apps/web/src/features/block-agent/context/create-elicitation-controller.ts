/**
 * The block's half of answering an elicitation: which question is live (the
 * fold's metadata slot), who may answer it, and the one POST that does.
 *
 * Not a queue. An answer is a response to a request the agent is blocked on,
 * so it goes straight out rather than behind queued prompts - and a second
 * answer to the same question is refused by the server (409), not merged.
 *
 * Anyone with edit access may answer - the same `EditAccessLevel` gate every
 * other control action has - so a surface shared with viewers (the session
 * split, a channel thread) reads {@link ElicitationController.canAnswer}
 * before offering a form, and says it is waiting on an editor otherwise.
 */

import { toast } from '@core/component/Toast/Toast';
import type { PendingElicitation } from '@service-agent-fold/generated/types';
import { agentHarnessServiceClient } from '@service-agent-harness/client';
import type { ElicitationAnswer } from '@service-agent-harness/generated/schemas';
import { type Accessor, createSignal } from 'solid-js';

export type ElicitationController = {
  /** The question awaiting an answer right now, if any. */
  pending: Accessor<PendingElicitation | undefined>;
  /**
   * Whether the viewer may answer: edit access on the session. `false`
   * until the session has loaded.
   */
  canAnswer: Accessor<boolean>;
  /** An answer is on the wire. */
  answering: Accessor<boolean>;
  /**
   * Answer the pending question. Resolves `true` when the service accepted
   * the answer; the fold then shows the outcome. A `409` means the agent is
   * no longer waiting (someone else answered, a stop cancelled it, or the
   * connection that asked is gone) - said once, and the metadata refresh
   * removes the form. A viewer without edit access gets `false` without a
   * request.
   */
  respond: (answer: ElicitationAnswer) => Promise<boolean>;
};

export function createElicitationController(options: {
  sessionId: Accessor<string | undefined>;
  pending: Accessor<PendingElicitation | undefined>;
  /** Whether the viewer may drive the session, once it has loaded. */
  canEdit: Accessor<boolean | undefined>;
}): ElicitationController {
  const [answering, setAnswering] = createSignal(false);

  const canAnswer = () => options.canEdit() === true;

  const respond = async (answer: ElicitationAnswer): Promise<boolean> => {
    const sessionId = options.sessionId();
    const pending = options.pending();
    if (!sessionId || !pending || answering() || !canAnswer()) return false;
    setAnswering(true);
    try {
      const result = await agentHarnessServiceClient.control(sessionId, {
        type: 'respondElicitation',
        requestId: pending.requestId,
        ...answer,
      });
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
    } finally {
      setAnswering(false);
    }
  };

  return {
    pending: options.pending,
    canAnswer,
    answering,
    respond,
  };
}
