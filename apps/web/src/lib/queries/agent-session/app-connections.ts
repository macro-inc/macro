import { agentHarnessServiceClient } from '@service-agent-harness/client';

/**
 * Tell the session its owner connected `appSlug`, so it continues the request
 * that asked for the app. The harness writes the continuation; nothing shows
 * in the transcript but the agent's reply, which every viewer gets through the
 * session's log, so this is not a cached mutation.
 */
export function reportAgentSessionAppConnected(
  sessionId: string,
  appSlug: string
) {
  return agentHarnessServiceClient.reportAppConnected(sessionId, appSlug);
}
