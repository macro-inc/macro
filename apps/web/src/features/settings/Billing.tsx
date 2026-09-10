import { PLAN_BY_TIER, type PlanTier } from '@app/features/paywall/plans';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { useHasPaidAccess } from '@core/auth';
import { toast } from '@core/component/Toast/Toast';
import { PERMISSION_IDS } from '@core/constant/permissions';
import { usePermissions, useUserId } from '@core/context/user';
import { plural } from '@core/util/string';
import CheckIcon from '@phosphor/check.svg';
import EnvelopeIcon from '@phosphor/envelope.svg';
import { useAiBillingSummaryQuery, useChangePlanMutation } from '@queries/auth';
import { useCurrentTeamQuery } from '@queries/team/teams';
import type { PaidPlan } from '@service-auth/ai-billing-types';
import { stripeServiceClient } from '@service-stripe/client';
import { Button, Layer } from '@ui';
import { createMemo, For, Match, Show, Switch } from 'solid-js';
import { AiUsageControls, AiUsageMeter } from './AiUsage';
import { SettingsCard, SettingsPage, SettingsSection } from './primitives';

const BILLING_PLAN_FEATURES: Record<PlanTier, string[]> = {
  free: ['Access to Haiku', 'MCP access', '5 GB storage'],
  premium: [
    'All agents',
    'All models',
    '$40 of AI usage each month',
    'No watermark',
    'AI projections',
    'Multiple email inboxes',
    'Calls',
    'Teams',
    '1 TB storage',
  ],
  max: [
    'Everything in Premium',
    '$200 of AI usage each month',
    'Priority support',
  ],
};

const PlanFeatures = (props: { tier: PlanTier }) => (
  <For each={BILLING_PLAN_FEATURES[props.tier]}>
    {(label) => (
      <li class="flex items-center gap-2">
        <CheckIcon class="size-3 text-success" />
        <span class="text-ink-muted text-xs">{label}</span>
      </li>
    )}
  </For>
);

const PlanPrice = (props: { tier: PaidPlan }) => (
  <p class="text-ink-extra-muted text-xs">
    ${PLAN_BY_TIER[props.tier].price} per seat / month · includes $
    {PLAN_BY_TIER[props.tier].aiIncluded} of AI usage
  </p>
);

export const Billing = () => {
  const permissions = usePermissions();
  const analytics = useAnalytics();
  const hasPaid = useHasPaidAccess();
  const userId = useUserId();
  const team = useCurrentTeamQuery();
  const summary = useAiBillingSummaryQuery();
  const changePlan = useChangePlanMutation();

  const canManageSubscription = createMemo(() => {
    return permissions()?.includes(PERMISSION_IDS.WRITE_STRIPE_SUBSCRIPTION);
  });

  const userTeam = createMemo(() => {
    const currentTeam = team.data;
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

  // The billing summary knows the tier (Premium vs Max); the license status is
  // the fallback while it loads or when the user is on the free plan.
  const tier = createMemo((): PlanTier => {
    if (summary.isSuccess) return summary.data.tier;
    return hasPaid() ? 'premium' : 'free';
  });
  const isOwnerOrSolo = () => !teamRole() || teamRole() === 'owner';
  const canChangePlan = () => canManageSubscription() && isOwnerOrSolo();

  const handleCheckout = async (plan: PaidPlan) => {
    try {
      const url = await stripeServiceClient.createCheckoutSessionV2({ plan });
      analytics.track('subscription_start', { type: plan });
      window.location.href = url;
    } catch (error) {
      console.error(error);
      toast.failure("Couldn't start checkout. Please try again.");
    }
  };

  const handleChangePlan = async (plan: PaidPlan) => {
    try {
      await changePlan.mutateAsync({ plan });
      analytics.track('plan_changed', { plan });
      toast.success(
        plan === 'max'
          ? 'Upgraded to Max. Your larger AI allowance applies right away.'
          : 'Switched to Premium.'
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

  const returnUrl = () => `${window.location.origin}/app/settings/billing`;

  return (
    <SettingsPage
      title="Billing"
      description={
        <>
          For questions about billing,{' '}
          <a
            class="text-link hover:text-link-hover visited:text-link-visited inline-flex items-center"
            href="mailto:support@macro.com"
          >
            contact us
            <EnvelopeIcon class="size-4 inline mx-1" />
          </a>
        </>
      }
    >
      <SettingsSection>
        <SettingsCard>
          <section class="flex flex-col gap-4 p-4">
            <header class="flex items-center gap-2">
              <div class="flex flex-col gap-1">
                <div class="flex items-center gap-2">
                  <h2 class="text-lg font-medium text-ink">
                    {PLAN_BY_TIER[tier()].name} plan
                  </h2>

                  <Layer depth={3}>
                    <span class="text-xs text-ink-muted px-1.5 py-0.25 border border-edge-muted rounded-md bg-active">
                      Current
                    </span>
                  </Layer>
                </div>
                <Switch>
                  <Match when={teamRole() === 'member'}>
                    <p class="text-ink-extra-muted text-xs">
                      Your subscription is managed by your team owner. Contact
                      them to make changes.
                    </p>
                  </Match>
                  <Match
                    when={hasPaid() && teamRole() === 'owner' && team.data}
                  >
                    {(team) => (
                      <p class="text-ink-extra-muted text-xs">
                        {team().members.length}{' '}
                        {plural('user', team().members.length)} • $
                        {PLAN_BY_TIER[tier()].price} per seat/per month
                      </p>
                    )}
                  </Match>
                </Switch>
              </div>

              <Show
                when={canManageSubscription() && hasPaid() && isOwnerOrSolo()}
              >
                <Button
                  class="ml-auto rounded-full bg-active"
                  size="sm"
                  depth={2}
                  variant="outline"
                  onClick={handleManage}
                >
                  Manage
                </Button>
              </Show>
            </header>
            <ul class="border-t border-t-edge-muted pt-4 flex flex-wrap gap-4 text-sm text-ink-muted">
              <PlanFeatures tier={tier()} />
            </ul>
          </section>
        </SettingsCard>
      </SettingsSection>

      <Show when={hasPaid() && summary.isSuccess && summary.data}>
        {(snapshot) => (
          <SettingsSection
            title="AI usage"
            description="Your plan includes AI each month at Macro's usage rates. Beyond that, prepaid credits and usage billing keep you going."
          >
            <SettingsCard>
              <section class="flex flex-col gap-5 p-4">
                <Show
                  when={!snapshot().unlimited}
                  fallback={
                    <p class="text-sm text-ink-muted">
                      Your enterprise plan includes unlimited AI usage.
                    </p>
                  }
                >
                  <AiUsageMeter snapshot={snapshot()} />
                  <div class="border-t border-t-edge-muted pt-4">
                    <AiUsageControls
                      snapshot={snapshot()}
                      returnUrl={returnUrl()}
                    />
                  </div>
                </Show>
              </section>
            </SettingsCard>
          </SettingsSection>
        )}
      </Show>

      <Show when={canChangePlan()}>
        <Switch>
          <Match when={!hasPaid()}>
            <SettingsSection title="Upgrade">
              <SettingsCard>
                <section class="flex flex-col gap-4 p-4">
                  <header class="flex items-center gap-2">
                    <div class="flex flex-col">
                      <h2 class="text-lg font-medium text-ink">Premium</h2>
                      <PlanPrice tier="premium" />
                    </div>
                    <Button
                      class="ml-auto rounded-full py-1.5 px-3"
                      depth={2}
                      variant="cta"
                      onClick={() => void handleCheckout('premium')}
                    >
                      Upgrade now
                    </Button>
                  </header>
                  <ul class="border-t border-t-edge-muted pt-4 flex flex-wrap gap-4 text-sm text-ink-muted">
                    <PlanFeatures tier="premium" />
                  </ul>
                </section>
              </SettingsCard>
              <SettingsCard>
                <section class="flex flex-col gap-4 p-4">
                  <header class="flex items-center gap-2">
                    <div class="flex flex-col">
                      <h2 class="text-lg font-medium text-ink">Max</h2>
                      <PlanPrice tier="max" />
                    </div>
                    <Button
                      class="ml-auto rounded-full py-1.5 px-3"
                      depth={2}
                      variant="outline"
                      onClick={() => void handleCheckout('max')}
                    >
                      Get Max
                    </Button>
                  </header>
                  <ul class="border-t border-t-edge-muted pt-4 flex flex-wrap gap-4 text-sm text-ink-muted">
                    <PlanFeatures tier="max" />
                  </ul>
                </section>
              </SettingsCard>
            </SettingsSection>
          </Match>
          <Match when={tier() === 'premium'}>
            <SettingsSection title="Need more AI?">
              <SettingsCard>
                <section class="flex flex-col gap-4 p-4">
                  <header class="flex items-center gap-2">
                    <div class="flex flex-col">
                      <h2 class="text-lg font-medium text-ink">Max</h2>
                      <PlanPrice tier="max" />
                    </div>
                    <Button
                      class="ml-auto rounded-full py-1.5 px-3"
                      depth={2}
                      variant="cta"
                      disabled={changePlan.isPending}
                      onClick={() => void handleChangePlan('max')}
                    >
                      Upgrade to Max
                    </Button>
                  </header>
                  <ul class="border-t border-t-edge-muted pt-4 flex flex-wrap gap-4 text-sm text-ink-muted">
                    <PlanFeatures tier="max" />
                  </ul>
                  <p class="text-xs text-ink-extra-muted">
                    Prorated for the rest of this period; every seat on your
                    team moves together.
                  </p>
                </section>
              </SettingsCard>
            </SettingsSection>
          </Match>
          <Match when={tier() === 'max'}>
            <SettingsSection>
              <p class="px-6 text-xs text-ink-extra-muted">
                Want a smaller plan?{' '}
                <button
                  type="button"
                  class="text-link hover:text-link-hover"
                  disabled={changePlan.isPending}
                  onClick={() => void handleChangePlan('premium')}
                >
                  Switch to Premium
                </button>{' '}
                ($40 per seat / month with $40 of AI usage).
              </p>
            </SettingsSection>
          </Match>
        </Switch>
      </Show>
    </SettingsPage>
  );
};
