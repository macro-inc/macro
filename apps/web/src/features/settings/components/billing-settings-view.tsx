import {
  type PaidPlanTier,
  PLAN_BY_TIER,
  PLAN_USAGE_LABELS,
  type PlanTier,
} from '@app/features/paywall/plans';
import { plural } from '@core/util/string';
import CheckIcon from '@phosphor/check.svg';
import EnvelopeIcon from '@phosphor/envelope.svg';
import { Button, Layer } from '@ui';
import { For, type JSX, Match, Show, Switch } from 'solid-js';
import { type BillingState, describeSeatPlans } from '../core/billing-state';
import { SettingsCard, SettingsPage } from '../primitives';

/**
 * Plan bullet points. Free and Pro allowance labels require AI usage billing;
 * Max always explains its larger allowance relative to Pro.
 */
const BILLING_PLAN_FEATURES: Record<
  PlanTier,
  (usage: string | undefined) => string[]
> = {
  free: (usage) => [
    'Access to Haiku',
    ...(usage ? [usage] : []),
    'MCP access',
    '2 connected email accounts',
    '5 GB storage',
  ],
  premium: (usage) => [
    'All agents',
    'All models',
    ...(usage ? [usage] : []),
    'No email watermark',
    'AI projections',
    'Unlimited connected email accounts',
    'Calls',
    'Teams',
    'Team-level memory',
    '100 GB storage',
  ],
  max: () => [
    'Everything in Pro',
    '10x more AI usage than Pro',
    'Unlimited connected email accounts',
    'Team-level memory',
    '1 TB storage',
    'Priority support',
  ],
};

const PlanFeatures = (props: { tier: PlanTier; aiUsageEnabled: boolean }) => {
  const allowance = () =>
    props.aiUsageEnabled ? PLAN_USAGE_LABELS[props.tier] : undefined;
  return (
    <For each={BILLING_PLAN_FEATURES[props.tier](allowance())}>
      {(label) => (
        <li class="flex items-center gap-2">
          <CheckIcon class="size-3 text-success" />
          <span class="text-ink-muted text-xs">{label}</span>
        </li>
      )}
    </For>
  );
};

const PlanPrice = (props: {
  tier: PaidPlanTier;
  perSeat: boolean;
  aiUsageEnabled: boolean;
}) => {
  return (
    <p class="text-ink-extra-muted text-xs">
      ${PLAN_BY_TIER[props.tier].price}{' '}
      {props.perSeat ? 'per seat / month' : '/ month'}
      <Show when={props.aiUsageEnabled}>
        <Show when={props.tier === 'max'}> · 10× usage</Show>
      </Show>
    </p>
  );
};

export function BillingSettingsView(props: {
  state: BillingState;
  controls?: JSX.Element;
  onManage: () => void;
  onSelectPlan: (plan: PaidPlanTier) => void;
  onTeamSettings?: JSX.EventHandler<HTMLAnchorElement, MouseEvent>;
}) {
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
      {props.controls}
      <section
        data-settings-target="subscription"
        tabIndex={-1}
        class="flex scroll-mt-4 flex-col gap-4 outline-none"
      >
        <h2 class="text-base font-medium text-ink">Subscription</h2>
        <SettingsCard>
          <section class="flex flex-col gap-4 p-5">
            <header class="flex items-center gap-2">
              <div class="flex flex-col gap-1">
                <div class="flex items-center gap-2">
                  <h3 class="text-lg font-medium text-ink">
                    {PLAN_BY_TIER[props.state.tier].name} plan
                  </h3>

                  <Layer depth={3}>
                    <span class="text-xs text-ink-muted px-1.5 py-0.25 border border-edge-muted rounded-md bg-active">
                      Current
                    </span>
                  </Layer>
                </div>
                <Switch>
                  <Match
                    when={
                      props.state.teamRole === 'member' &&
                      props.state.billedThroughTeam
                    }
                  >
                    <p class="text-ink-extra-muted text-xs">
                      Your seat is billed through your team. Team admins choose
                      each seat's plan in{' '}
                      <a
                        class="text-link hover:text-link-hover"
                        href="/app/settings/team"
                        onClick={props.onTeamSettings}
                      >
                        Team settings
                      </a>
                      .
                    </p>
                  </Match>
                  <Match
                    when={
                      props.state.hasPaid &&
                      props.state.teamRole === 'owner' &&
                      props.state.teamPlans
                    }
                  >
                    {(plans) => (
                      <p class="text-ink-extra-muted text-xs">
                        {plans().length} {plural('user', plans().length)} •{' '}
                        {describeSeatPlans(plans())} • set each seat's plan in{' '}
                        <a
                          class="text-link hover:text-link-hover"
                          href="/app/settings/team"
                          onClick={props.onTeamSettings}
                        >
                          Team settings
                        </a>
                      </p>
                    )}
                  </Match>
                </Switch>
              </div>

              <Show when={props.state.canChangePlan && props.state.hasPaid}>
                <Button
                  class="ml-auto bg-active"
                  size="sm"
                  depth={2}
                  variant="outline"
                  onClick={props.onManage}
                >
                  Manage
                </Button>
              </Show>
            </header>
            <ul class="border-t border-t-edge-muted pt-4 flex flex-wrap gap-4 text-sm text-ink-muted">
              <PlanFeatures
                tier={props.state.tier}
                aiUsageEnabled={props.state.aiUsageEnabled}
              />
            </ul>
          </section>
        </SettingsCard>
      </section>

      <Show when={props.state.canChangePlan}>
        <section
          data-settings-target="upgrade"
          tabIndex={-1}
          class="@container/plan-options flex scroll-mt-4 flex-col gap-4 outline-none"
        >
          <h2 class="text-base font-medium text-ink">
            {props.state.tier === 'max'
              ? 'Change plan'
              : props.state.hasPaid && props.state.aiUsageEnabled
                ? 'Need more AI?'
                : 'Upgrade'}
          </h2>
          <div
            class="grid grid-cols-1 gap-6"
            classList={{
              '@2xl/plan-options:grid-cols-2': !props.state.hasPaid,
            }}
          >
            <For
              each={(['premium', 'max'] as const).filter(
                (plan) => !props.state.hasPaid || plan !== props.state.tier
              )}
            >
              {(plan) => (
                <SettingsCard class="@container/plan-card h-full">
                  <section class="flex h-full flex-col gap-4 p-5">
                    <header class="grid grid-cols-1 items-center gap-4 @sm/plan-card:grid-cols-[minmax(0,1fr)_auto]">
                      <div class="flex min-w-0 flex-col gap-1">
                        <div class="flex flex-wrap items-center gap-2">
                          <h3 class="text-lg font-medium text-ink">
                            {PLAN_BY_TIER[plan].name}
                          </h3>
                          <Show
                            when={!props.state.hasPaid && plan === 'premium'}
                          >
                            <span class="text-sm font-medium text-accent">
                              Free for one month!
                            </span>
                          </Show>
                        </div>
                        <PlanPrice
                          tier={plan}
                          perSeat={!!props.state.teamRole}
                          aiUsageEnabled={props.state.aiUsageEnabled}
                        />
                      </div>
                      <Button
                        class="w-full py-1.5 px-3 @sm/plan-card:w-auto @sm/plan-card:justify-self-end"
                        depth={2}
                        variant="cta"
                        disabled={props.state.pending}
                        onClick={() => props.onSelectPlan(plan)}
                      >
                        {props.state.hasPaid
                          ? plan === 'premium'
                            ? 'Switch to Pro'
                            : 'Upgrade to Max'
                          : plan === 'premium'
                            ? 'Get Pro'
                            : 'Get Max'}
                      </Button>
                    </header>
                    <ul class="border-t border-t-edge-muted pt-4 flex flex-col gap-3 text-sm text-ink-muted">
                      <PlanFeatures
                        tier={plan}
                        aiUsageEnabled={props.state.aiUsageEnabled}
                      />
                    </ul>
                    <Show
                      when={
                        props.state.hasPaid &&
                        (plan === 'max' || props.state.teamRole === 'owner')
                      }
                    >
                      <p class="text-xs text-ink-extra-muted">
                        <Show when={plan === 'max'}>
                          Prorated for the rest of this period.
                        </Show>
                        <Show when={props.state.teamRole === 'owner'}>
                          {' '}
                          This moves only your seat; teammates' plans are set
                          per seat in Team settings.
                        </Show>
                      </p>
                    </Show>
                  </section>
                </SettingsCard>
              )}
            </For>
          </div>
        </section>
      </Show>
    </SettingsPage>
  );
}
