import {
  formatPlanPrice,
  type PaidPlanTier,
  PLANS,
} from '@app/features/paywall/plans';
import type {
  AiPlanCatalog,
  AiPlanCatalogEntry,
} from '@service-auth/ai-billing-types';
import type { BillingInterval } from '@service-auth/generated/schemas/billingInterval';
import { Tabs } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import type { Loadable } from '../context/onboarding-context';
import { PLAN_COMPARISON } from '../core/plan-comparison';

export function PlanComparison(props: {
  catalog: Loadable<AiPlanCatalog>;
  disabled: boolean;
  trialEligible: boolean;
  existingSubscription: boolean;
  onRetry: () => void;
  onContinueFree: () => void;
  onBackToPro: () => void;
  onStartPlan: (plan: PaidPlanTier, interval: BillingInterval) => void;
}) {
  const entries = () => {
    const state = props.catalog;
    return state.t === 'ready' ? state.value.plans : [];
  };
  // Business and Max are offered annually first; Pro is monthly only.
  const [interval, setChosenInterval] = createSignal<BillingInterval>('year');
  const annual = (entry: AiPlanCatalogEntry | undefined) =>
    interval() === 'year' ? entry?.annual_price_per_month_cents : undefined;
  const price = (entry: AiPlanCatalogEntry | undefined) =>
    annual(entry) ?? entry?.monthly_price_cents;
  return (
    <section class="mx-auto w-full max-w-3xl px-6 pb-20 pt-20 font-[Inter_Variable] text-sm leading-7 text-ink-muted sm:pb-28 sm:pt-24 sm:text-[15px]">
      <div class="mb-10 h-px w-12 bg-edge" aria-hidden="true" />
      <p class="mb-4 text-xs text-ink-extra-muted">Free, Pro, Business & Max</p>
      <h2
        tabindex="-1"
        class="mb-7 text-2xl font-medium leading-8 tracking-tight text-ink outline-none sm:text-[28px] sm:leading-9"
      >
        Choose what works for you.
      </h2>
      <p>
        Start with Free, with no credit card needed. Pro unlocks every AI model,
        removes the email watermark, and gives you more storage and team
        features. Business and Max add more AI, SSO, a signed DPA, and
        white-glove onboarding for larger teams.
      </p>
      <Tabs<BillingInterval>
        aria-label="Billing interval"
        class="mt-6"
        value={interval()}
        onChange={setChosenInterval}
        options={[
          { value: 'year', label: 'Billed annually' },
          { value: 'month', label: 'Billed monthly' },
        ]}
      />
      <Show when={props.catalog.t === 'error'}>
        <p role="alert" class="mt-5">
          We couldn't load plan prices. You can continue with Free or{' '}
          <button type="button" class="underline" onClick={props.onRetry}>
            try again
          </button>
          .
        </p>
      </Show>
      <table class="mt-10 w-full table-fixed border-collapse text-left text-xs leading-5 sm:text-sm sm:leading-6">
        <caption class="sr-only">
          Compare Free, Pro, Business, and Max plans
        </caption>
        <thead>
          <tr class="border-b border-edge">
            <th
              scope="col"
              class="w-[24%] pb-5 pr-2 align-top font-medium text-ink sm:pr-4"
            >
              What’s included
            </th>
            <For each={PLANS}>
              {(plan) => {
                const entry = () =>
                  entries().find((item) => item.tier === plan.tier);
                return (
                  <th
                    scope="col"
                    class="w-[19%] pb-5 pr-2 align-top font-medium text-ink last:pr-0 sm:pr-4"
                  >
                    {plan.name}
                    <span class="mt-1.5 block text-xs font-normal leading-5 text-ink-muted [overflow-wrap:anywhere]">
                      {plan.tier === 'free' ? (
                        '$0'
                      ) : (
                        <>
                          <Show
                            when={
                              plan.tier === 'premium' && props.trialEligible
                            }
                          >
                            30 days free, then{' '}
                          </Show>
                          <span class="block whitespace-nowrap max-[375px]:text-[10px]">
                            {formatPlanPrice(price(entry())) ?? '—'}
                            <span title="per user per month">/usr/mo</span>
                          </span>
                          <Show when={annual(entry()) !== undefined}>
                            <span class="block">billed annually</span>
                          </Show>
                        </>
                      )}
                    </span>
                  </th>
                );
              }}
            </For>
          </tr>
        </thead>
        <tbody>
          <For each={PLAN_COMPARISON}>
            {(row) => (
              <tr class="border-b border-edge-muted last:border-b-0">
                <th
                  scope="row"
                  class="py-4 pr-2 align-top font-normal sm:py-5 sm:pr-4"
                >
                  {row.feature}
                </th>
                <For each={PLANS}>
                  {(plan) => (
                    <td class="py-4 pr-2 align-top last:pr-0 sm:py-5 sm:pr-4">
                      {row.values[plan.tier]}
                    </td>
                  )}
                </For>
              </tr>
            )}
          </For>
        </tbody>
        <tfoot>
          <tr>
            <td />
            <For each={PLANS}>
              {(plan) => (
                <td class="pt-6 pr-2 align-top last:pr-0 sm:pr-4">
                  <button
                    type="button"
                    disabled={
                      props.disabled ||
                      (plan.tier !== 'free' && props.existingSubscription) ||
                      ((plan.tier === 'business' || plan.tier === 'max') &&
                        !entries().find((item) => item.tier === plan.tier)
                          ?.purchasable)
                    }
                    onClick={() => {
                      if (plan.tier === 'free') return props.onContinueFree();
                      if (plan.tier === 'premium') return props.onBackToPro();
                      props.onStartPlan(plan.tier, interval());
                    }}
                    class="flex min-h-10 w-full items-center justify-center rounded-full border border-edge px-2 py-2 text-center text-[11px] font-medium leading-4 text-ink-muted hover:border-ink-muted hover:text-ink disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink sm:px-3"
                  >
                    Continue with {plan.name}
                  </button>
                </td>
              )}
            </For>
          </tr>
        </tfoot>
      </table>
    </section>
  );
}
