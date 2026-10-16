import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useHasPaidAccess } from '@core/auth';
import { enableAiUsageBilling } from '@core/constant/featureFlags';
import { type PaywallKey, PaywallMessages } from '@core/constant/PaywallState';
import { useSettingsState } from '@core/constant/SettingsState';
import { useUserId } from '@core/context/user';
import { useAiBillingSummaryQuery } from '@queries/auth';
import { useCurrentTeamQuery } from '@queries/team/teams';
import { getBillingState } from '../settings/core/billing-state';
import { PaywallView } from './components/paywall-view';

export interface PaywallProps {
  cb: () => Promise<void> | void;
  errorKey?: PaywallKey | null;
}

/** App wiring for the upgrade modal; cards and account policy are shared with Billing. */
const PaywallComponent = (props: PaywallProps) => {
  const { openSettings } = useSettingsState();
  const hasPaid = useHasPaidAccess();
  const userId = useUserId();
  const aiUsageBilling = useFeatureFlag(enableAiUsageBilling);
  const team = useCurrentTeamQuery();
  const summary = useAiBillingSummaryQuery();
  const availability = () =>
    team.isPending || summary.isPending
      ? 'loading'
      : team.isSuccess && summary.isSuccess
        ? 'ready'
        : 'error';
  const state = () => {
    const currentTeam = team.isSuccess ? team.data : undefined;
    const currentSummary = summary.isSuccess ? summary.data : undefined;
    return getBillingState({
      hasPaid: currentSummary ? currentSummary.tier !== 'free' : hasPaid(),
      canManageSubscription: team.isSuccess,
      teamRole: currentTeam
        ? currentTeam.team.owner_id === userId()
          ? 'owner'
          : 'member'
        : undefined,
      summary: currentSummary
        ? {
            tier: currentSummary.tier,
            canManageBilling: currentSummary.can_manage_billing,
          }
        : undefined,
      aiUsageEnabled: aiUsageBilling().enabled,
      pending: false,
    });
  };

  return (
    <PaywallView
      state={state()}
      availability={availability()}
      metadata={props.errorKey ? PaywallMessages[props.errorKey] : undefined}
      onDismiss={props.cb}
      onManagePlan={async () => {
        await props.cb();
        openSettings('Billing');
      }}
      onRetry={() => {
        void team.refetch();
        void summary.refetch();
      }}
    />
  );
};

export default PaywallComponent;
