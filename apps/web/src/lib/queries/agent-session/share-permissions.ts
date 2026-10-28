import { agentHarnessServiceClient } from '@service-agent-harness/client';
import type { UpdateSharePermissionRequestV2 } from '@service-agent-harness/generated/schemas';

/** The shared share dialog owns loading and refreshing these permissions. */
export function fetchAgentSessionSharePermissions(sessionId: string) {
  return agentHarnessServiceClient.getPermissions(sessionId);
}

export function updateAgentSessionSharePermissions(
  sessionId: string,
  permissions: UpdateSharePermissionRequestV2
) {
  return agentHarnessServiceClient.updatePermissions(sessionId, permissions);
}
