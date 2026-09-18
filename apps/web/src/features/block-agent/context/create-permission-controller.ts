import type { IssueResult } from '@core/agent-session/AgentSession';
import { toast } from '@core/component/Toast/Toast';
import type { AgentRequestId } from '@service-agent-fold/generated/types';
import type {
  AgentAction,
  PermissionAnswer,
} from '@service-agent-harness/generated/schemas';
import type { Accessor } from 'solid-js';
import { createStore } from 'solid-js/store';

export type PermissionController = {
  canAnswer: Accessor<boolean>;
  respond: (
    requestId: AgentRequestId,
    answer: PermissionAnswer
  ) => Promise<boolean>;
  answering: (requestId: AgentRequestId) => boolean;
};

/** Permission answers use the session's control path and retain the agent's id. */
export function createPermissionController(options: {
  sessionId: Accessor<string | undefined>;
  canEdit: Accessor<boolean | undefined>;
  issue: (action: AgentAction) => Promise<IssueResult> | undefined;
}): PermissionController {
  const [answering, setAnswering] = createStore<Record<string, boolean>>({});
  const canAnswer = () => options.canEdit() === true;
  const respond = async (
    requestId: AgentRequestId,
    answer: PermissionAnswer
  ): Promise<boolean> => {
    // Numeric and string JSON-RPC ids identify different requests.
    const sessionId = options.sessionId();
    const key = JSON.stringify([sessionId, requestId]);
    if (!sessionId || !canAnswer() || answering[key]) return false;
    setAnswering(key, true);
    try {
      const result = await options.issue({
        type: 'respondToPermission',
        requestId,
        answer,
      });
      if (!result) return false;
      if (result.isErr()) {
        toast.failure('The permission request could not be answered');
        return false;
      }
      return true;
    } catch {
      toast.failure('The permission request could not be answered');
      return false;
    } finally {
      setAnswering(key, false);
    }
  };
  return {
    canAnswer,
    respond,
    answering: (requestId) =>
      answering[JSON.stringify([options.sessionId(), requestId])] === true,
  };
}
