import type { Accessor } from 'solid-js';
import { useAgentToolPermissionsQuery } from './queries/permissions';
import { useTeamToolPermissionsQuery } from './queries/team';
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
  // Gated on success: reading `data` while pending would suspend the list.
  return () => flag() && view.isSuccess && view.data != null;
}

/**
 * Whether the team default row should show: the flag is on and the API has
 * the team's default permissions (the viewer is a member).
 */
export function useTeamPermissionsAvailable(
  teamId: Accessor<string | undefined>
): Accessor<boolean> {
  const flag = useAgentPermissionsFlag();
  const view = useTeamToolPermissionsQuery(
    () => teamId() ?? '',
    () => flag() && teamId() !== undefined
  );
  // Gated on success: reading `data` while pending would suspend the list.
  return () =>
    flag() && teamId() !== undefined && view.isSuccess && view.data != null;
}
