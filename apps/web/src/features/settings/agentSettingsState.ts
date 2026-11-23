import type { PermissionFocus } from '@app/features/agent-permissions';
import { createSignal } from 'solid-js';

/**
 * Asks the Agents settings page to open one agent's editor, its permissions
 * page, or the create form with a machine already chosen under Where it runs.
 */
export type AgentSettingsRequest =
  | { id: number; type: 'edit'; agentId: string }
  | {
      id: number;
      type: 'permissions';
      agentId: string;
      focus?: PermissionFocus;
    }
  | { id: number; type: 'create'; harnessId: string };

const [agentSettingsRequest, setAgentSettingsRequest] =
  createSignal<AgentSettingsRequest>();
let nextRequestId = 0;

export { agentSettingsRequest };

export function requestAgentDetail(agentId: string) {
  setAgentSettingsRequest({ id: ++nextRequestId, type: 'edit', agentId });
}

/**
 * Opens an agent's permissions page (the Macro persona's too), optionally
 * at one group, action or tool.
 */
export function requestAgentPermissions(
  agentId: string,
  focus?: PermissionFocus
) {
  setAgentSettingsRequest({
    id: ++nextRequestId,
    type: 'permissions',
    agentId,
    focus,
  });
}

/** Opens the create form with `harnessId` as the machine it runs on. */
export function requestCreateAgent(harnessId: string) {
  setAgentSettingsRequest({ id: ++nextRequestId, type: 'create', harnessId });
}

export function consumeAgentSettingsRequest(id: number) {
  if (agentSettingsRequest()?.id === id) setAgentSettingsRequest(undefined);
}
