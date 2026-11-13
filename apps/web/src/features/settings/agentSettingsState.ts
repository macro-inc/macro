import { createSignal } from 'solid-js';

/**
 * Asks the Agents settings page to open one agent's editor, or the create
 * form with a machine already chosen under Where it runs.
 */
export type AgentSettingsRequest =
  | { id: number; type: 'edit'; agentId: string }
  | { id: number; type: 'create'; harnessId: string };

const [agentSettingsRequest, setAgentSettingsRequest] =
  createSignal<AgentSettingsRequest>();
let nextRequestId = 0;

export { agentSettingsRequest };

export function requestAgentDetail(agentId: string) {
  setAgentSettingsRequest({ id: ++nextRequestId, type: 'edit', agentId });
}

/** Opens the create form with `harnessId` as the machine it runs on. */
export function requestCreateAgent(harnessId: string) {
  setAgentSettingsRequest({ id: ++nextRequestId, type: 'create', harnessId });
}

export function consumeAgentSettingsRequest(id: number) {
  if (agentSettingsRequest()?.id === id) setAgentSettingsRequest(undefined);
}
