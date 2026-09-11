import { agentHarnessServiceClient } from '@service-agent-harness/client';
import type { ControlRequest } from '@service-agent-harness/generated/schemas';

/** Send a session action while preserving the client's typed result. */
export function controlAgentSession(
  sessionId: string,
  request: ControlRequest
) {
  return agentHarnessServiceClient.control(sessionId, request);
}
