import type { TeamWithMembers } from '@service-auth/generated/schemas/teamWithMembers';
import { useQuery } from '@tanstack/solid-query';
import { type Accessor, createMemo } from 'solid-js';
import { queryReadyGate } from '../gate';
import { teamKeys } from './keys';

const NO_TEAMMATES: ReadonlySet<string> = new Set();

function rosterIds(team: TeamWithMembers | null): string[] {
  return (team?.members ?? []).map((member) => member.user_id.toLowerCase());
}

function sameIds(previous: ReadonlySet<string>, next: ReadonlySet<string>) {
  if (previous.size !== next.size) return false;
  for (const id of previous) if (!next.has(id)) return false;
  return true;
}

/** Who is on the viewer's team roster, the viewer included. Empty until the
 * roster has loaded and for someone without a team. It observes the roster
 * the app shell keeps loaded (`useCurrentTeamQuery`) and never fetches it, so
 * a people list can mount where no team service exists. */
export function useTeammateIds(
  enabled: Accessor<boolean>
): Accessor<ReadonlySet<string>> {
  const roster = useQuery<TeamWithMembers | null, Error, string[]>(() => ({
    queryKey: teamKeys.currentTeam.queryKey,
    // Observe only: `useCurrentTeamQuery` owns this key's fetcher.
    enabled: false,
    select: rosterIds,
  }));
  return createMemo(
    // A failed refetch keeps the roster it already had.
    (): ReadonlySet<string> =>
      enabled() && queryReadyGate(roster) ? new Set(roster.data) : NO_TEAMMATES,
    NO_TEAMMATES,
    { equals: sameIds }
  );
}
