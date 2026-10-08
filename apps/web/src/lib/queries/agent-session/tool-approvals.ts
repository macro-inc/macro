import { agentHarnessServiceClient } from '@service-agent-harness/client';
import type { ToolApprovalAnswerDto } from '@service-agent-harness/generated/schemas';

/**
 * Answer a tool call held for the session owner. Not a cached mutation: the
 * outcome reaches every viewer through the session's log, and the caller
 * branches on the result's error codes (an already-answered call is a
 * conflict, not a failure).
 */
export function answerAgentSessionToolApproval(
  sessionId: string,
  approvalId: string,
  answer: ToolApprovalAnswerDto
) {
  return agentHarnessServiceClient.answerToolApproval(
    sessionId,
    approvalId,
    answer
  );
}
