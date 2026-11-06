import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import { usePending } from '@app/observability/flow';
import { enableTeamAgents } from '@core/constant/featureFlags';
import { queryReadyGate } from '@queries/gate';
import { useTeamAgentsQuery } from '@queries/team-agents';
import type { SubscriptionBilling } from '@service-auth/generated/schemas';
import { Show } from 'solid-js';
import { TeamBillingBreakdown } from '../components/team-billing-breakdown';
import { BillingComputers } from '../computers/views/BillingComputers';

export function ConnectedTeamBillingBreakdown(props: {
  teamId?: string;
  billing: SubscriptionBilling;
}) {
  const flag = useFeatureFlag(enableTeamAgents);
  const enabled = () => !flag().loading && flag().enabled && !!props.teamId;
  const agents = useTeamAgentsQuery(() => props.teamId ?? '', enabled);
  usePending('team-agent.billing-roster', () => enabled() && agents.isLoading);
  return (
    <Show
      when={!flag().loading}
      fallback={<p role="status">{t('agentInvite.loadingFeatures')}</p>}
    >
      <Show when={flag().enabled} fallback={<BillingComputers />}>
        <TeamBillingBreakdown
          billing={props.billing}
          agents={queryReadyGate(agents) ? agents.data.agents : []}
        />
      </Show>
    </Show>
  );
}
