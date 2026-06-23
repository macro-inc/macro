import { useAnalytics } from '@app/component/analytics-context';
import type { PlanTier } from '@app/component/paywall/plans';
import { useHasPaidAccess } from '@core/auth';
import CheckIcon from '@phosphor/check.svg';
import ArrowSquareOutIcon from '@phosphor/arrow-square-out.svg';
import { stripeServiceClient } from '@service-stripe/client';
import { Button, Layer, Surface } from '@ui';
import { createMemo, For, Show } from 'solid-js';
import { useUserTeamsQuery } from '@queries/team';
import { usePermissions, useUserId } from '@core/context/user';
import { PERMISSION_IDS } from '@core/constant/permissions';

const BILLING_PLAN_FEATURES: Record<PlanTier, string[]> = {
  free: ['Access to Haiku', '5 GB storage', 'Multiple email inboxes'],
  premium: [
    'All agents',
    'All models',
    'No watermark',
    'MCP access',
    'AI projections',
    'Multiple email inboxes',
    'Calls',
    'Teams',
    '1 TB storage',
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

export const Billing = () => {
  const permissions = usePermissions();
  const analytics = useAnalytics();
  const hasPaid = useHasPaidAccess();

  const userId = useUserId();

  const userTeamsQuery = useUserTeamsQuery();

  const canManageSubscription = createMemo(() => {
    return permissions()?.includes(PERMISSION_IDS.WRITE_STRIPE_SUBSCRIPTION);
  });

  const userTeam = createMemo(() => {
    const teams = userTeamsQuery.data;
    const uid = userId();
    if (!teams || !uid) return;

    // Assume the user can only be on one team
    // This is the case atm
    const firstTeam = teams[0];

    return firstTeam;
  });

  const teamRole = createMemo(() => {
    const uid = userId();
    const team = userTeam();

    if (!team) return;

    return team.owner_id === uid ? 'owner' : 'member';
  });

  const handleCheckout = async () => {
    try {
      const url = await stripeServiceClient.createCheckoutSessionV2({});
      analytics.track('subscription_start', {
        type: 'premium',
      });
      window.location.href = url;
    } catch (error) {
      console.error(error);
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
    <section class="p-8 flex flex-col gap-8">
      <header class="flex flex-col">
        <h1 class="text-2xl text-ink font-medium">Billing</h1>
        <p class="text-ink-extra-muted text-sm">
          For questions about billing,{' '}
          <a
            class="text-ink inline-flex items-center hover:text-accent"
            href="https://cal.com/team/macro/macro-demo-call"
            target="_blank"
            rel="noopener"
          >
            contact us
            <ArrowSquareOutIcon class="size-4 inline mx-1" />
          </a>
        </p>
      </header>

      <Surface class="flex flex-col rounded-lg p-4" depth={2}>
        <section class="flex flex-col gap-4">
          <header class="flex items-cetner gap-2">
            <div class="flex flex-col gap-1">
              <div class="flex items-center gap-2">
                <h1 class="text-base font-medium text-ink">
                  <Show when={!hasPaid()} fallback={'Premium plan'}>
                    Free plan
                  </Show>
                </h1>

                <Layer depth={3}>
                  <span class="text-xs text-ink-muted px-1.5 py-0.25 border border-edge-muted rounded-md bg-active">
                    Current
                  </span>
                </Layer>
              </div>
              <Show when={teamRole() === 'member'}>
                <p class="text-ink-extra-muted text-xs">
                  Your subscription is managed by your team owner. Contact them
                  to make changes.
                </p>
              </Show>
            </div>

            <Show
              when={
                canManageSubscription() &&
                hasPaid() &&
                (!teamRole() || teamRole() === 'owner')
              }
            >
              <Button
                class="ml-auto rounded-full bg-active"
                size="sm"
                depth={2}
                variant="base"
                onClick={handleManage}
              >
                Manage
              </Button>
            </Show>
          </header>
          <ul class="border-t border-t-edge-muted pt-4 flex flex-wrap gap-4 text-sm text-ink-muted">
            <PlanFeatures tier={hasPaid() ? 'premium' : 'free'} />
          </ul>
        </section>
      </Surface>
      <Show when={!hasPaid()}>
        <Surface class="flex flex-col rounded-lg p-4" depth={2}>
          <section class="flex flex-col gap-4">
            <header class="flex items-center gap-2">
              <div class="flex flex-col">
                <h1 class="text-base font-medium text-ink">Premium</h1>
                <p class="text-ink-extra-muted text-xs">$40 per month</p>
              </div>

              <Button
                class="ml-auto rounded-full py-1.5 px-3"
                depth={2}
                variant="cta"
                onClick={handleCheckout}
              >
                Upgrade now
              </Button>
            </header>
            <ul class="border-t border-t-edge-muted pt-4 flex flex-wrap gap-4 text-sm text-ink-muted">
              <PlanFeatures tier="premium" />
            </ul>
          </section>
        </Surface>
      </Show>
    </section>
  );
};
