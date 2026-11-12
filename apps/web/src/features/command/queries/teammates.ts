import { queryReadyGate } from '@queries/gate';
import { useCurrentTeamQuery } from '@queries/team/teams';
import { type Accessor, createMemo } from 'solid-js';

/** Whether a user is on the viewer's team; false until the team loads. */
export function useIsTeammate(
  enabled: Accessor<boolean>
): (userId: string) => boolean {
  const team = useCurrentTeamQuery(enabled);
  const ids = createMemo(
    () =>
      new Set(
        (queryReadyGate(team) ? (team.data?.members ?? []) : []).map((member) =>
          member.user_id.toLowerCase()
        )
      )
  );
  return (userId) => ids().has(userId.toLowerCase());
}
