import { createSignal } from 'solid-js';

/** Asks the Agents settings page to open one agent's editor. */
export type AgentSettingsRequest = { id: number; agentId: string };

const [agentSettingsRequest, setAgentSettingsRequest] =
  createSignal<AgentSettingsRequest>();
let nextRequestId = 0;

export { agentSettingsRequest };

export function requestAgentDetail(agentId: string) {
  setAgentSettingsRequest({ id: ++nextRequestId, agentId });
}

export function consumeAgentSettingsRequest(id: number) {
  if (agentSettingsRequest()?.id === id) setAgentSettingsRequest(undefined);
}
