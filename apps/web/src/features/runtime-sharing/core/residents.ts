import type { HarnessResident } from '@service-storage/client';

/** Who holds access to a runtime, as far as its residents depend on it. */
export type RuntimeAccessHolders = {
  ownerId: string;
  /** People holding a direct grant. */
  grantedUserIds: readonly string[];
  /** Members of the team it is open to; empty when it is not open to one. */
  teamMemberIds: readonly string[];
};

/**
 * The residents a person's removal shuts down: their own agents, unless they
 * still reach the runtime through its team grant.
 */
export function residentsLosingAccessWithUser(
  residents: readonly HarnessResident[],
  holders: RuntimeAccessHolders,
  userId: string
): HarnessResident[] {
  if (holders.teamMemberIds.includes(userId)) return [];
  return residents.filter((resident) => resident.owner_user_id === userId);
}

/**
 * The residents closing a runtime to a team shuts down: the team's own agents,
 * and agents of members with no direct grant to fall back on.
 */
export function residentsLosingAccessWithTeam(
  residents: readonly HarnessResident[],
  holders: RuntimeAccessHolders,
  teamId: string
): HarnessResident[] {
  return residents.filter((resident) => {
    if (resident.team_id === teamId) return true;
    const owner = resident.owner_user_id;
    return (
      !!owner &&
      owner !== holders.ownerId &&
      holders.teamMemberIds.includes(owner) &&
      !holders.grantedUserIds.includes(owner)
    );
  });
}
