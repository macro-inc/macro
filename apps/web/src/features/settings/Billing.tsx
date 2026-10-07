import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useHasPaidAccess } from '@core/auth';
import { toast } from '@core/component/Toast/Toast';
import { enableAiUsageBilling, LOCAL_ONLY } from '@core/constant/featureFlags';
import { PERMISSION_IDS } from '@core/constant/permissions';
import { usePermissions, useUserId } from '@core/context/user';
import { lazyNamed } from '@core/util/lazyNamed';
import {
  useAiBillingSummaryQuery,
  useChangePlanMutation,
  useCreateCheckoutSessionMutation,
} from '@queries/auth';
import { useCurrentTeamQuery } from '@queries/team/teams';
import type { PaidPlan } from '@service-auth/ai-billing-types';
import { stripeServiceClient } from '@service-stripe/client';
import { createMemo, type JSX, Suspense } from 'solid-js';
import { BillingSettingsView } from './components/billing-settings-view';
import {
  getBillingState,
  getFreePlanCheckoutRequest,
} from './core/billing-state';

const BillingPreview =
  import.meta.env.DEV && LOCAL_ONLY
    ? lazyNamed(() => import('./views/billing-preview'), 'BillingPreview')
    : undefined;

export function Billing() {
  if (BillingPreview) {
    return (
      <Suspense fallback={<p role="status">Loading billing…</p>}>
        <BillingPreview
          renderLive={(controls) => <LiveBilling controls={controls} />}
        />
      </Suspense>
    );
  }
  return <LiveBilling />;
}

function LiveBilling(props: { controls?: JSX.Element }) {
  const permissions = usePermissions();
  const analytics = useAnalytics();
  const hasPaid = useHasPaidAccess();
  const userId = useUserId();
  const team = useCurrentTeamQuery();
  const summary = useAiBillingSummaryQuery();
  const aiUsageBilling = useFeatureFlag(enableAiUsageBilling);
  const changePlan = useChangePlanMutation();
  const checkout = useCreateCheckoutSessionMutation();
  const effectiveHasPaid = () =>
    hasPaid() || (summary.isSuccess && summary.data.tier !== 'free');

  const canManageSubscription = createMemo(() => {
    return permissions()?.includes(PERMISSION_IDS.WRITE_STRIPE_SUBSCRIPTION);
  });

  const userTeam = createMemo(() => {
    const currentTeam = team.isSuccess ? team.data : undefined;
    const uid = userId();
    if (!currentTeam || !uid) return;

    return currentTeam.team;
  });

  const teamRole = createMemo(() => {
    const uid = userId();
    const team = userTeam();

    if (!team) return;

    return team.owner_id === uid ? 'owner' : 'member';
  });

  const state = () =>
    getBillingState({
      hasPaid: effectiveHasPaid(),
      canManageSubscription: team.isSuccess && canManageSubscription() === true,
      teamRole: teamRole(),
      teamPlans: team.isSuccess
        ? team.data?.members.map((member) =>
            (member as typeof member & { plan?: PaidPlan }).plan === 'max'
              ? 'max'
              : 'premium'
          )
        : undefined,
      summary: summary.isSuccess
        ? {
            tier: summary.data.tier,
            canManageBilling: summary.data.can_manage_billing,
          }
        : undefined,
      aiUsageEnabled: aiUsageBilling().enabled,
      pending: checkout.isPending || changePlan.isPending,
    });

  const handleCheckout = async (plan: PaidPlan) => {
    try {
      const url = await checkout.mutateAsync(getFreePlanCheckoutRequest(plan));
      analytics.track('subscription_start', { type: plan });
      window.location.href = url;
    } catch (error) {
      console.error(error);
      toast.failure(
        error instanceof Error
          ? error.message.replace(/Premium/g, 'Pro')
          : "Couldn't start checkout. Please try again."
      );
    }
  };

  const handleChangePlan = async (plan: PaidPlan) => {
    try {
      await changePlan.mutateAsync({ plan });
      analytics.track('plan_changed', { plan });
      toast.success(
        plan === 'max'
          ? aiUsageBilling().enabled
            ? 'Upgraded to Max. Your larger AI allowance applies right away.'
            : 'Upgraded to Max.'
          : 'Switched to Pro.'
      );
    } catch (error) {
      console.error(error);
      toast.failure("Couldn't change your plan. Please try again.");
    }
  };

  const handleManage = async () => {
    try {
      const url = await stripeServiceClient.createPortalSession();
      window.location.href = url;
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <BillingSettingsView
      state={state()}
      controls={props.controls}
      onManage={() => void handleManage()}
      onSelectPlan={(plan) =>
        void (effectiveHasPaid()
          ? handleChangePlan(plan)
          : handleCheckout(plan))
      }
    />
  );
}
