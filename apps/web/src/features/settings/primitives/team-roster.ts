import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableAgentTeammates } from '@core/constant/featureFlags';
import { getDisplayName, macroIdToEmail, tryMacroId } from '@core/user';
import { thrownResultErrorHasCode } from '@core/util/result';
import { queryReadyGate } from '@queries/gate';
import { useTeamAgentsQuery } from '@queries/team-agents/team-agents';
import type { TeamMember } from '@service-auth/generated/schemas/teamMember';
import { TeamRole } from '@service-auth/generated/schemas/teamRole';
import type { Accessor } from 'solid-js';

const ROLE_ORDER: Record<string, number> = {
  [TeamRole.owner]: 0,
  [TeamRole.admin]: 1,
  [TeamRole.member]: 2,
};

/** Owners, then admins, then members, each in id order, as Members lists them. */
export function sortTeamMembers(members: TeamMember[]): TeamMember[] {
  return [...members].sort((a, b) => {
    const roleCompare = (ROLE_ORDER[a.role] ?? 3) - (ROLE_ORDER[b.role] ?? 3);
    if (roleCompare !== 0) return roleCompare;
    return a.user_id.localeCompare(b.user_id);
  });
}

export function memberName(member: TeamMember) {
  return getDisplayName(tryMacroId(member.user_id));
}

/** The member's email, when their name is something else. */
export function memberEmail(member: TeamMember) {
  const id = tryMacroId(member.user_id);
  const email = id ? macroIdToEmail(id) : undefined;
  return email && email !== memberName(member) ? email : undefined;
}

/** Owners and admins always have CRM access; a member has it unless turned off. */
export function hasCrmAccess(
  member: TeamMember,
  access: Record<string, boolean> | undefined
) {
  return member.role !== TeamRole.member || access?.[member.user_id] !== false;
}

/**
 * A team's agent teammates, listed once `enable-agent-teammates` is on.
 * Loading is not on, so a roster read before the flag settles lists no agents;
 * a failed refetch keeps the agents last read. The server refuses the read
 * while the agent teammates rollout is off for the viewer: then there are no
 * agents to tell apart, as Members shows none. `known` is true once the flag
 * has answered and, when it is on, the agents have been read or refused;
 * `failed` is a first read that failed otherwise, which `retry` reads again.
 */
export function useTeamAgents(teamId: Accessor<string>) {
  const flag = useFeatureFlag(enableAgentTeammates);
  const enabled = () => !flag().loading && flag().enabled;
  const query = useTeamAgentsQuery(teamId, enabled);
  const agents = () =>
    enabled() && queryReadyGate(query) ? query.data.agents : [];
  const refused = () =>
    thrownResultErrorHasCode(query.error, 'FORBIDDEN') ||
    thrownResultErrorHasCode(query.error, 'UNAUTHORIZED');
  const unread = () => query.isError && query.data === undefined;
  const known = () =>
    !flag().loading &&
    (!enabled() || queryReadyGate(query) || (unread() && refused()));
  const failed = () => enabled() && unread() && !refused();
  return { enabled, agents, known, failed, retry: () => query.refetch() };
}
