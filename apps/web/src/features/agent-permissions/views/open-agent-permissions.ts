import { useSettingsState } from '@core/constant/SettingsState';
import { requestAgentPermissions } from '../../settings/agentSettingsState';
import type { PermissionFocus } from '../core/model';

/**
 * Opens Settings → Agents with an agent's permissions expanded, at an action
 * or tool when given: beside the current split on desktop (so a chat that
 * links to it stays in view), in the settings sheet on phones.
 */
export function useOpenAgentPermissions() {
  const settings = useSettingsState();
  return (agentId: string, focus?: PermissionFocus) => {
    requestAgentPermissions(agentId, focus);
    settings.openSettingsInSplit('Agents');
  };
}
