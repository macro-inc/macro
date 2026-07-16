import { type TeamMember, TeamRole } from '@service-auth/generated/schemas';

export function isTeamAdminOrOwner(role: TeamRole | undefined): boolean {
  return role === TeamRole.admin || role === TeamRole.owner;
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
