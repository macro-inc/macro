import { createSignal } from 'solid-js';

/**
 * Asks Settings → Members to open Bring your AI for one agent teammate, from
 * its ready notification. The agent's row opens it once its computer's
 * runtime is listed as the viewer's own, so only owners and admins see it.
 */
export type AgentClaudeRequest = { id: number; agentUserId: string };

const [agentClaudeRequest, setAgentClaudeRequest] =
  createSignal<AgentClaudeRequest>();
let nextRequestId = 0;

export { agentClaudeRequest };

export function requestAgentClaude(agentUserId: string) {
  setAgentClaudeRequest({ id: ++nextRequestId, agentUserId });
}

export function consumeAgentClaudeRequest(id: number) {
  if (agentClaudeRequest()?.id === id) setAgentClaudeRequest(undefined);
}
