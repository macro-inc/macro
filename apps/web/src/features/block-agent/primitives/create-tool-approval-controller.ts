import type { FetchWithTokenErrorCode } from '@core/util/fetchWithToken';
import type { ResultError } from '@core/util/result';
import type { PendingInteraction } from '@service-agent-fold/generated/types';
import type {
  AnswerToolApprovalResponse,
  ToolApprovalAnswerDto,
} from '@service-agent-harness/generated/schemas';
import type { Result } from 'neverthrow';
import type { Accessor } from 'solid-js';
import { createStore } from 'solid-js/store';

/** A tool call the egress proxy holds until the session owner approves it. */
export type HeldToolApproval = Extract<
  PendingInteraction,
  { kind: 'tool_approval' }
>;

export type ToolApprovalSource = {
  sessionId: Accessor<string | undefined>;
  pending: Accessor<readonly PendingInteraction[]>;
  /** The session's owner: the only one who may approve or decline. */
  ownerId: Accessor<string | undefined>;
  /** The viewer. */
  userId: Accessor<string | undefined>;
  /** Edit access, which is enough to cancel. */
  canEdit: Accessor<boolean | undefined>;
  onFailure: (message: string) => void;
  /** Sends an answer to the harness. */
  answer: (
    sessionId: string,
    approvalId: string,
    answer: ToolApprovalAnswerDto
  ) => Promise<
    Result<AnswerToolApprovalResponse, ResultError<FetchWithTokenErrorCode>[]>
  >;
};

export type ToolApprovalController = {
  pending: Accessor<readonly HeldToolApproval[]>;
  /**
   * The viewer may approve or decline: the session's owner, or, for a hold
   * on the agent's permissions, the approver it names.
   */
  canApprove: (request?: HeldToolApproval) => boolean;
  /** The viewer may give up waiting on the owner. */
  canCancel: Accessor<boolean>;
  answering: (approvalId: string) => boolean;
  answer: (
    approvalId: string,
    answer: ToolApprovalAnswerDto
  ) => Promise<boolean>;
};

/**
 * Answers held tool calls. Unlike a permission, the answer is not an agent
 * action: the call is held at the egress proxy, not by the agent, so it goes
 * to the proxy's own endpoint and the log reports the outcome.
 */
export function createToolApprovalController(
  source: ToolApprovalSource
): ToolApprovalController {
  const [answering, setAnswering] = createStore<
    Record<string, true | undefined>
  >({});
  const pending = () =>
    source
      .pending()
      .filter(
        (request): request is HeldToolApproval =>
          request.kind === 'tool_approval'
      );
  const canApprove = (request?: HeldToolApproval) => {
    // A permission hold names its approver; others answer to the owner.
    const approver = request?.approver ?? source.ownerId();
    return approver !== undefined && approver === source.userId();
  };
  const canCancel = () => source.canEdit() === true;

  const answer = async (
    approvalId: string,
    answer: ToolApprovalAnswerDto
  ): Promise<boolean> => {
    const sessionId = source.sessionId();
    const request = pending().find(
      (candidate) => candidate.approvalId === approvalId
    );
    const allowed = answer === 'cancel' ? canCancel() : canApprove(request);
    if (!sessionId || !request || !allowed || answering[approvalId])
      return false;

    setAnswering(approvalId, true);
    try {
      const result = await source.answer(sessionId, approvalId, answer);
      if (result.isErr()) {
        source.onFailure(
          result.error.some((error) => error.code === 'CONFLICT')
            ? 'That tool call was already answered'
            : "Couldn't send your answer"
        );
        return false;
      }
      return true;
    } catch {
      source.onFailure("Couldn't send your answer");
      return false;
    } finally {
      setAnswering(approvalId, undefined);
    }
  };

  return {
    pending,
    canApprove,
    canCancel,
    answering: (approvalId) => answering[approvalId] === true,
    answer,
  };
}
