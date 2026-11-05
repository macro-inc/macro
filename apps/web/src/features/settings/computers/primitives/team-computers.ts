import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableMacroComputers } from '@core/constant/featureFlags';
import { useComputersQuery } from '@queries/computers/computers';
import { queryReadyGate } from '@queries/gate';
import { useCurrentTeamQuery } from '@queries/team/teams';
import type { ComputerStatus } from '@service-auth/computers';

/**
 * The current team's live (not released) Macro computers. Computers are
 * team-only: without a team, or with the flag off, nothing is fetched.
 */
export function useTeamComputers() {
  const flag = useFeatureFlag(enableMacroComputers);
  const team = useCurrentTeamQuery();
  const enabled = () =>
    flag().enabled && queryReadyGate(team) && team.data !== null;
  const query = useComputersQuery(enabled);

  const computers = (): ComputerStatus[] =>
    query.isSuccess
      ? query.data.filter((computer) => computer.status !== 'released')
      : [];

  return {
    enabled,
    computers,
    failed: () => query.isError,
  };
}
