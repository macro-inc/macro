import {
  type PaidPlanTier,
  PLAN_BY_TIER,
  type PlanTier,
  planBenefits,
} from '@app/features/paywall/plans';
import CheckIcon from '@phosphor-icons/core/bold/check-bold.svg';
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

/** Plan cards shared by Billing settings and the upgrade paywall. */
export function BillingPlanCard(props: {
  plan: PaidPlanTier;
  state: Pick<
    BillingState,
    'hasPaid' | 'teamRole' | 'aiUsageEnabled' | 'pending'
  >;
  onSelectPlan?: (plan: PaidPlanTier) => void;
}) {
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
              <Show when={!props.state.hasPaid && props.plan === 'premium'}>
                <span class="text-sm font-medium text-accent">
                  Free for one month!
                </span>
              </Show>
            </div>
            <PlanPrice
              tier={props.plan}
              perSeat={!!props.state.teamRole}
              aiUsageEnabled={props.state.aiUsageEnabled}
            />
          </div>
          <Show when={props.onSelectPlan}>
            <Button
              class="w-full py-1.5 px-3 @sm/plan-card:w-auto @sm/plan-card:justify-self-end"
              depth={2}
              variant="cta"
              disabled={props.state.pending}
              onClick={() => props.onSelectPlan?.(props.plan)}
            >
              {props.state.hasPaid
                ? props.plan === 'premium'
                  ? 'Switch to Pro'
                  : 'Upgrade to Max'
                : props.plan === 'premium'
                  ? 'Get Pro'
                  : 'Get Max'}
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
            (props.plan === 'max' || props.state.teamRole === 'owner')
          }
        >
          <p class="text-xs text-ink-extra-muted">
            <Show when={props.plan === 'max'}>
              Prorated for the rest of this period.
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
