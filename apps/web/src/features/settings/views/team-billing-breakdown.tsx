import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { usePending } from '@app/observability/flow';
import { enableTeamAgents } from '@core/constant/featureFlags';
import { queryReadyGate } from '@queries/gate';
import { useTeamAgentsQuery } from '@queries/team-agents';
import type { SubscriptionBilling } from '@service-auth/generated/schemas';
import { TeamBillingBreakdown } from '../components/team-billing-breakdown';

export function ConnectedTeamBillingBreakdown(props: {
  teamId?: string;
  billing: SubscriptionBilling;
}) {
  const flag = useFeatureFlag(enableTeamAgents);
  const enabled = () => flag().enabled && !!props.teamId;
  const agents = useTeamAgentsQuery(() => props.teamId ?? '', enabled);
  usePending('team-agent.billing-roster', () => enabled() && agents.isLoading);
  return (
    <TeamBillingBreakdown
      billing={props.billing}
      agents={queryReadyGate(agents) ? agents.data.agents : []}
    />
  );
}
