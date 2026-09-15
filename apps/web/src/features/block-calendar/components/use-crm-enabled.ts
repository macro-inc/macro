import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableCrm } from '@core/constant/featureFlags';
import { useCurrentTeamQuery } from '@queries/team/teams';

/**
 * Whether guests can resolve to CRM records: the flag is on and the viewer's
 * team has CRM enabled. `teamId` is empty until the team is known.
 */
export function useCrmEnabled() {
  const crmFlag = useFeatureFlag(enableCrm);
  const teamQuery = useCurrentTeamQuery();
  const team = () => (teamQuery.isSuccess ? teamQuery.data?.team : undefined);

  return {
    teamId: () => team()?.id ?? '',
    crmEnabled: () => crmFlag().enabled && team()?.crm_enabled === true,
  };
}
