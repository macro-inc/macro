import type { TeamAgent } from '@service-auth/generated/schemas';
import { type TeamMember, TeamRole } from '@service-auth/generated/schemas';

export function isTeamAdminOrOwner(role: TeamRole | undefined): boolean {
  return role === TeamRole.admin || role === TeamRole.owner;
}

/** Admins and owners can always invite; members only when the team allows it. */
export function canInviteToTeam(
  role: TeamRole | undefined,
  allowNonAdminInvites: boolean
): boolean {
  return isTeamAdminOrOwner(role) || allowNonAdminInvites;
}

export function canRemoveTeamMember(
  actingUserId: string | undefined,
  actingRole: TeamRole | undefined,
  targetMember: TeamMember
): boolean {
  return (
    actingUserId !== undefined &&
    isTeamAdminOrOwner(actingRole) &&
    targetMember.user_id !== actingUserId &&
    targetMember.role !== TeamRole.owner
  );
}

/** Retrying provisioning never starts a new purchase. */
export function canRetryTeamAgent(agent: TeamAgent): boolean {
  return (
    agent.retryable && (agent.payment === 'paid' || agent.payment === 'comped')
  );
}
