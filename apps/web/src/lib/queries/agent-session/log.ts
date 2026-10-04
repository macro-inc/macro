import { agentHarnessServiceClient } from '@service-agent-harness/client';

/** Read the authoritative log; the shared fold owns its in-memory projection. */
export function fetchAgentSessionLog(sessionId: string) {
  return agentHarnessServiceClient.getLog(sessionId);
}
