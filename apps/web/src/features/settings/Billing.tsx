import type { PlanTier } from '@app/features/paywall/plans';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { useHasPaidAccess } from '@core/auth';
import { PERMISSION_IDS } from '@core/constant/permissions';
import { usePermissions, useUserId } from '@core/context/user';
import { plural } from '@core/util/string';
import CheckIcon from '@phosphor/check.svg';
import EnvelopeIcon from '@phosphor/envelope.svg';
import { useCurrentTeamQuery } from '@queries/team/teams';
import { stripeServiceClient } from '@service-stripe/client';
import { Button, Layer } from '@ui';
import { createMemo, For, Match, Show, Switch } from 'solid-js';
import { SettingsCard, SettingsPage, SettingsSection } from './primitives';

const BILLING_PLAN_FEATURES: Record<PlanTier, string[]> = {
  free: ['Access to Haiku', 'MCP access', '5 GB storage'],
  premium: [
    'All agents',
    'All models',
    'No watermark',
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

  const team = useCurrentTeamQuery();

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
                    <Show when={!hasPaid()} fallback={'Premium plan'}>
                      Free plan
                    </Show>
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
                        {plural('user', team().members.length)} • $40 per
                        seat/per month
                      </p>
                    )}
                  </Match>
                </Switch>
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
                  variant="outline"
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
        </SettingsCard>
      </SettingsSection>

      <Show
        when={
          !hasPaid() &&
          canManageSubscription() &&
          (!teamRole() || teamRole() === 'owner')
        }
      >
        <SettingsSection>
          <SettingsCard>
            <section class="flex flex-col gap-4 p-4">
              <header class="flex items-center gap-2">
                <div class="flex flex-col">
                  <h2 class="text-lg font-medium text-ink">Premium</h2>
                  <p class="text-ink-extra-muted text-xs">
                    $40 per seat / month
                  </p>
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
          </SettingsCard>
        </SettingsSection>
      </Show>
    </SettingsPage>
  );
};
