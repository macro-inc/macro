import type { PlanTier } from '@app/features/paywall/plans';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useHasPaidAccess } from '@core/auth';
import { toast } from '@core/component/Toast/Toast';
import { enableAiUsageBilling } from '@core/constant/featureFlags';
import { PERMISSION_IDS } from '@core/constant/permissions';
import { usePermissions, useUserId } from '@core/context/user';
import { plural } from '@core/util/string';
import {
  useAiBillingSummaryQuery,
  useChangePlanMutation,
  useCreateCheckoutSessionMutation,
  useSubscriptionStatusQuery,
} from '@queries/auth';
import { queryReadyGate } from '@queries/gate';
import { useCurrentTeamQuery } from '@queries/team/teams';
import type { PaidPlan } from '@service-auth/ai-billing-types';
import type { TeamMember } from '@service-auth/generated/schemas/teamMember';
import { stripeServiceClient } from '@service-stripe/client';
import { createMemo } from 'solid-js';
import type { BillingContext } from './context/billing-context';
import { BillingSettingsView } from './views/billing-settings';

/** "3 Pro seats, 1 Max seat" for a team's members. */
function describeSeatPlans(members: TeamMember[]): string {
  const maxSeats = members.filter(
    (member) => (member as TeamMember & { plan?: PaidPlan }).plan === 'max'
  ).length;
  const premiumSeats = members.length - maxSeats;
  const parts: string[] = [];
  if (premiumSeats > 0) {
    parts.push(`${premiumSeats} Pro ${plural('seat', premiumSeats)}`);
  }
  if (maxSeats > 0) {
    parts.push(`${maxSeats} Max ${plural('seat', maxSeats)}`);
  }
  return parts.join(', ');
}

export const Billing = () => {
  const permissions = usePermissions();
  const analytics = useAnalytics();
  const hasPaid = useHasPaidAccess();
  const userId = useUserId();
  const team = useCurrentTeamQuery();
  const summary = useAiBillingSummaryQuery();
  const subscriptionStatus = useSubscriptionStatusQuery({ enabled: hasPaid });
  const aiUsageBilling = useFeatureFlag(enableAiUsageBilling);
  const changePlan = useChangePlanMutation();
  const checkout = useCreateCheckoutSessionMutation();

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

  // The billing summary knows the tier (Pro vs Max); the license status is
  // the fallback while it loads or when the user is on the free plan.
  const tier = createMemo((): PlanTier => {
    if (summary.isSuccess) return summary.data.tier;
    return hasPaid() ? 'premium' : 'free';
  });
  // A member whose seat the team pays for manages nothing here; a member of
  // a free team pays for themself and gets the same controls as a solo user.
  const billedThroughTeam = () =>
    summary.isSuccess &&
    !summary.data.can_manage_billing &&
    summary.data.tier !== 'free';
  const isOwnerOrSolo = () =>
    !teamRole() || teamRole() === 'owner' || !billedThroughTeam();
  const canChangePlan = () => canManageSubscription() && isOwnerOrSolo();

  const handleCheckout = async (plan: PaidPlan) => {
    try {
      const url = await checkout.mutateAsync({ plan });
      analytics.track('subscription_start', { type: plan });
      window.location.href = url;
    } catch (error) {
      console.error(error);
      toast.failure("Couldn't start checkout. Please try again.");
    }
  };

  const handleChangePlan = async (plan: PaidPlan) => {
    try {
      const previous = tier();
      await changePlan.mutateAsync({ plan });
      analytics.track('plan_changed', { plan });
      toast.success(
        plan === previous
          ? `Keeping your ${plan === 'max' ? 'Max' : 'Pro'} plan. Your scheduled downgrade is canceled.`
          : plan === 'max'
            ? aiUsageBilling().enabled
              ? 'Upgraded to Max. Your larger AI allowance applies right away.'
              : 'Upgraded to Max.'
            : 'Pro will start at your next renewal. You keep Max until then.'
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

  const context: BillingContext = {
    tier,
    renewalDate: () =>
      queryReadyGate(subscriptionStatus)
        ? (subscriptionStatus.data.renewalDate ?? undefined)
        : undefined,
    scheduledChange: () =>
      queryReadyGate(subscriptionStatus)
        ? (subscriptionStatus.data.scheduledChange ?? undefined)
        : undefined,
    subscriptionStatusFailed: () => subscriptionStatus.isError,
    refreshStatus: () => void subscriptionStatus.refetch(),
    hasPaid,
    teamRole,
    billedThroughTeam,
    isOwnerOrSolo,
    canManageSubscription: () => !!canManageSubscription(),
    canChangePlan: () => !!canChangePlan(),
    aiUsageBilling: () => !!aiUsageBilling().enabled,
    changingPlan: () => changePlan.isPending,
    teamSeatDescription: () =>
      team.isSuccess && team.data
        ? `${team.data.members.length} ${plural('user', team.data.members.length)} • ${describeSeatPlans(team.data.members)}`
        : undefined,
    checkout: handleCheckout,
    changePlan: handleChangePlan,
    manage: handleManage,
  };
  return <BillingSettingsView context={context} />;
};
