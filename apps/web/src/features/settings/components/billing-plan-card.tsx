import {
  isUpgrade,
  type PaidPlanTier,
  PLAN_BY_TIER,
  PLAN_USAGE_LABELS,
  type PlanTier,
  planBenefits,
  planPriceAt,
} from '@app/features/paywall/plans';
import type { BillingInterval } from '@service-auth/generated/schemas/billingInterval';
import CheckIcon from '@phosphor-fill/check-fat-fill.svg';
import { Button } from '@ui';
import { For, Show } from 'solid-js';
import type { BillingState } from '../core/billing-state';
import { SettingsCard } from '../primitives';

export const PlanFeatures = (props: {
  tier: PlanTier;
  aiUsageEnabled: boolean;
}) => {
  return (
    <For each={planBenefits(props.tier, props.aiUsageEnabled)}>
      {(label) => (
        <li class="flex items-center gap-2">
          <CheckIcon class="size-3 shrink-0 text-success" />
          <span class="text-ink-muted text-xs">{label}</span>
        </li>
      )}
    </For>
  );
};

const PlanPrice = (props: {
  tier: PaidPlanTier;
  interval: BillingInterval;
  perSeat: boolean;
  aiUsageEnabled: boolean;
}) => {
  return (
    <p class="text-ink-extra-muted text-xs">
      ${planPriceAt(props.tier, props.interval)}{' '}
      {props.perSeat ? 'per seat / month' : '/ month'}
      {props.interval === 'year' ? ', billed annually' : ''}
      <Show when={props.aiUsageEnabled && props.tier !== 'premium'}>
        {' '}
        · {PLAN_USAGE_LABELS[props.tier]}
      </Show>
    </p>
  );
};

const SERVICE_LABEL = {
  'self-serve': 'Self-serve',
  'white-glove': 'White-glove onboarding',
} as const;

/** Plan cards shared by Billing settings and the upgrade paywall. */
export function BillingPlanCard(props: {
  plan: PaidPlanTier;
  /** The interval the card prices at and a purchase starts on. */
  interval: BillingInterval;
  state: Pick<
    BillingState,
    | 'hasPaid'
    | 'tier'
    | 'teamRole'
    | 'aiUsageEnabled'
    | 'pending'
    | 'trialEligible'
    | 'trialing'
  >;
  onSelectPlan?: (plan: PaidPlanTier, interval: BillingInterval) => void;
}) {
  const name = () => PLAN_BY_TIER[props.plan].name;
  const upgrade = () => isUpgrade(props.state.tier, props.plan);
  return (
    <SettingsCard class="@container/plan-card h-full">
      <section class="flex h-full flex-col gap-4 p-5">
        <header
          class="grid grid-cols-1 items-center gap-4"
          classList={{
            '@sm/plan-card:grid-cols-[minmax(0,1fr)_auto]':
              !!props.onSelectPlan,
          }}
        >
          <div class="flex min-w-0 flex-col gap-1">
            <div class="flex flex-wrap items-center gap-2">
              <h3 class="text-lg font-medium text-ink">
                {PLAN_BY_TIER[props.plan].name}
              </h3>
              <Show
                when={
                  !props.state.hasPaid &&
                  props.plan === 'premium' &&
                  props.state.trialEligible === true
                }
              >
                <span class="text-sm font-medium text-accent">
                  Free for one month!
                </span>
              </Show>
            </div>
            <PlanPrice
              tier={props.plan}
              interval={props.interval}
              perSeat={!!props.state.teamRole}
              aiUsageEnabled={props.state.aiUsageEnabled}
            />
            <Show when={PLAN_BY_TIER[props.plan].service}>
              {(service) => (
                <p class="text-ink-extra-muted text-xs">
                  {SERVICE_LABEL[service()]}
                </p>
              )}
            </Show>
          </div>
          <Show when={props.onSelectPlan}>
            <Button
              class="w-full py-1.5 px-3 @sm/plan-card:w-auto @sm/plan-card:justify-self-end"
              variant="primary"
              disabled={
                props.state.pending ||
                (!props.state.hasPaid &&
                  props.plan === 'premium' &&
                  props.state.trialEligible === undefined)
              }
              onClick={() => props.onSelectPlan?.(props.plan, props.interval)}
            >
              {props.state.hasPaid
                ? upgrade()
                  ? `Upgrade to ${name()}`
                  : `Switch to ${name()}`
                : `Get ${name()}`}
            </Button>
          </Show>
        </header>
        <ul class="border-t border-t-edge-muted pt-4 flex flex-col gap-3 text-sm text-ink-muted">
          <PlanFeatures
            tier={props.plan}
            aiUsageEnabled={props.state.aiUsageEnabled}
          />
        </ul>
        <Show
          when={
            props.state.hasPaid &&
            props.onSelectPlan &&
            (upgrade() || props.state.teamRole === 'owner')
          }
        >
          <p class="text-xs text-ink-extra-muted">
            <Show when={upgrade()}>
              {props.state.trialing
                ? 'Charged today. The Pro trial ends.'
                : 'Prorated for the rest of this period.'}
            </Show>
            <Show when={props.state.teamRole === 'owner'}>
              {' '}
              This moves only your seat; teammates' plans are set per seat in
              Team settings.
            </Show>
          </p>
        </Show>
      </section>
    </SettingsCard>
  );
}
