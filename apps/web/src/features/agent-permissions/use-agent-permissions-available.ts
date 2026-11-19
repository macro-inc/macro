import type { Accessor } from 'solid-js';
import { useAgentToolPermissionsQuery } from './queries/permissions';
import { useAgentPermissionsFlag } from './use-agent-permissions-flag';

/**
 * Whether an entry point to an agent's permissions should show: the flags are
 * on and the API has the agent's permissions. A 404 (the feature is off for
 * the caller on the server, or the agent has none) hides it, as does a load
 * that hasn't answered yet.
 */
export function useAgentPermissionsAvailable(
  agentId: Accessor<string>
): Accessor<boolean> {
  const flag = useAgentPermissionsFlag();
  const view = useAgentToolPermissionsQuery(agentId, flag);
  return () => flag() && view.data != null;
}
