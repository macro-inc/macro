import { globalSplitManager } from '@app/signal/splitLayout';
import { createSignal } from 'solid-js';
import { openTeamMembersSettings } from '../../notifications/notification-navigation';

/**
 * Asks Settings → Members to open Connect Claude plan for one agent teammate, from
 * its first direct message. The agent's row opens it once its computer's
 * runtime is listed as the viewer's own, so only owners and admins see it.
 */
export type AgentClaudeRequest = { id: number; agentUserId: string };

const [agentClaudeRequest, setAgentClaudeRequest] =
  createSignal<AgentClaudeRequest>();
let nextRequestId = 0;

export { agentClaudeRequest };

export function openAgentClaude(agentUserId: string) {
  const layout = globalSplitManager();
  if (!layout) return;
  setAgentClaudeRequest({ id: ++nextRequestId, agentUserId });
  openTeamMembersSettings(layout, {});
}

export function consumeAgentClaudeRequest(id: number) {
  if (agentClaudeRequest()?.id === id) setAgentClaudeRequest(undefined);
}
