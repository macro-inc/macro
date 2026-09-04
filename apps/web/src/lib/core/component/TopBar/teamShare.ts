import type { TeamShareAccessLevel } from '@queries/storage/team-share';
import type { AccessLevel } from '@service-storage/generated/schemas/accessLevel';
import type { UpdateSharePermissionRequestV2 } from '@service-storage/generated/schemas/updateSharePermissionRequestV2';

/**
 * Explicit team share payload. Kept separate from `LinkSharePayload` so a team
 * change never rides along with (and never resets) the link share. The key is
 * always present: a level shares the item with everyone on the owner's team,
 * `null` stops sharing. "Leave unchanged" means not sending a payload at all.
 */
export type TeamSharePayload = Required<
  Pick<UpdateSharePermissionRequestV2, 'teamShareAccessLevel'>
> & { teamShareAccessLevel: TeamShareAccessLevel | null };

export const TEAM_SHARE_ROW_COPY = {
  fallbackLabel: 'Team',
  subtitle: 'Everyone on the team',
} as const;

/**
 * Builds the payload for a level picked in the Team row, or `undefined` when
 * there is nothing to send: `owner` can never be granted to a team, and
 * re-picking the current level is a no-op.
 */
export function buildTeamSharePayload(
  nextAccessLevel: AccessLevel | null,
  currentAccessLevel?: AccessLevel | null
): TeamSharePayload | undefined {
  if (nextAccessLevel === 'owner') return undefined;
  if ((currentAccessLevel ?? null) === nextAccessLevel) return undefined;
  return { teamShareAccessLevel: nextAccessLevel };
}

/** Team row label: the owner's team name when known, else a generic "Team". */
export function getTeamShareRowLabel(teamName?: string | null): string {
  const trimmed = teamName?.trim();
  return trimmed || TEAM_SHARE_ROW_COPY.fallbackLabel;
}
