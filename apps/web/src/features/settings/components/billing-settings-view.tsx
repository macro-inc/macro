import { BillingCycleDialog } from '@app/features/paywall/components/billing-cycle-dialog';
import {
  defaultInterval,
  type PaidPlanTier,
  PLAN_BY_TIER,
  type PlanTier,
  soldAt,
} from '@app/features/paywall/plans';
import { plural } from '@core/util/string';
import CalendarIcon from '@icon/system/regular/calendar-blank.svg';
import EnvelopeIcon from '@icon/system/regular/envelope.svg';
import type { BillingInterval } from '@service-auth/generated/schemas/billingInterval';
import { Button, Layer } from '@ui';
import { createSignal, For, type JSX, Match, Show, Switch } from 'solid-js';
import {
  type BillingState,
  cardInterval,
  describeSeatPlans,
} from '../core/billing-state';
import { SettingsCard, SettingsPage } from '../primitives';
import { BillingPlanCard, PlanFeatures } from './billing-plan-card';

export function BillingSettingsView(props: {
  state: BillingState;
  controls?: JSX.Element;
  renewalDate?: string;
  scheduledChange?: { plan: PlanTier; effectiveAt: string };
  subscriptionStatusFailed?: boolean;
  onRefreshStatus?: () => void;
  trialEligibilityFailed?: boolean;
  onRefreshTrialEligibility?: () => void;
  onKeepPlan?: (plan: PaidPlanTier) => void;
  teamSeatDescription?: string;
  onManage: () => void;
  onSelectPlan: (plan: PaidPlanTier, interval: BillingInterval) => void;
  onTeamSettings?: JSX.EventHandler<HTMLAnchorElement, MouseEvent>;
  /** The subscription breakdown, or the computers list when billing is unavailable. */
  computers?: JSX.Element;
}) {
  // Free-tier checkouts for plans with annual and monthly options confirm
  // the billing cycle in a compact dialog before launching Stripe Checkout.
  const [cyclePlan, setCyclePlan] = createSignal<PaidPlanTier | null>(null);
  const handleSelectPlan = (plan: PaidPlanTier, interval: BillingInterval) => {
    if (!props.state.hasPaid && PLAN_BY_TIER[plan].annualPrice !== undefined) {
      setCyclePlan(plan);
      return;
    }
    props.onSelectPlan(plan, interval);
  };
  // A paid plan change keeps the subscription's interval, so until it is
  // known no card is priced or offered.
  const offeredPlans = () =>
    (['premium', 'business', 'max'] as const).filter((plan) => {
      if (!props.state.hasPaid) return true;
      const interval = props.state.interval;
      if (interval === undefined || plan === props.state.tier) return false;
      return soldAt(plan, interval);
    });
  const formatDate = (value: string | undefined) => {
    if (!value) return;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return;
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };
  const scheduledChange = () => {
    const change = props.scheduledChange;
    const date = formatDate(change?.effectiveAt);
    return change && date ? { ...change, date } : undefined;
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
                        href="/app/settings/team-members"
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
                      (props.teamSeatDescription || props.state.teamPlans)
                    }
                  >
                    <p class="text-ink-extra-muted text-xs">
                      {props.teamSeatDescription ||
                        `${props.state.teamPlans?.length} ${plural('user', props.state.teamPlans?.length ?? 0)} • ${describeSeatPlans(props.state.teamPlans ?? [])}`}{' '}
                      • set each seat's plan in{' '}
                      <a
                        class="text-link hover:text-link-hover"
                        href="/app/settings/team-members"
                        onClick={props.onTeamSettings}
                      >
                        Team settings
                      </a>
                    </p>
                  </Match>
                </Switch>
                <Show
                  when={props.state.hasPaid && formatDate(props.renewalDate)}
                >
                  {(date) => (
                    <p class="text-xs text-ink-extra-muted">
                      {scheduledChange()?.plan === 'free'
                        ? 'Your subscription ends on '
                        : 'Your current billing period ends on '}
                      {date()}.
                    </p>
                  )}
                </Show>
              </div>

              <Show
                when={
                  props.state.canManageBilling &&
                  (props.state.hasPaid || props.state.existingSubscription)
                }
              >
                <Button
                  class="ml-auto bg-active"
                  size="sm"
                  variant="secondary"
                  onClick={props.onManage}
                >
                  Manage
                </Button>
              </Show>
            </header>
            <Show
              when={
                props.state.canManageBilling &&
                props.state.existingSubscription &&
                !props.state.hasPaid
              }
            >
              <p role="status" class="text-sm text-ink-muted">
                You have an existing subscription. Use Manage to review your
                subscription and payment details.
              </p>
            </Show>
            <ul class="border-t border-t-edge-muted pt-4 flex flex-wrap gap-4 text-sm text-ink-muted">
              <PlanFeatures
                tier={props.state.tier}
                aiUsageEnabled={props.state.aiUsageEnabled}
              />
            </ul>
          </section>
        </SettingsCard>
        <Show when={props.subscriptionStatusFailed}>
          <div
            class="flex flex-wrap items-center gap-3 px-4 text-xs text-ink-muted"
            role="status"
          >
            <p>Couldn't load your renewal details.</p>
            <Button variant="ghost" size="sm" onClick={props.onRefreshStatus}>
              Try again
            </Button>
          </div>
        </Show>
        <Show when={scheduledChange()}>
          {(change) => (
            <SettingsCard>
              <div class="flex flex-wrap items-center gap-3 p-4" role="status">
                <CalendarIcon class="size-4 shrink-0 text-ink-muted" />
                <p class="min-w-0 flex-1 text-sm text-ink">
                  {change().plan === 'free'
                    ? 'Your subscription cancellation'
                    : `Your downgrade to ${PLAN_BY_TIER[change().plan].name}`}{' '}
                  is scheduled for {change().date}.
                </p>
                <Show
                  when={
                    props.state.canChangePlan && props.state.tier !== 'free'
                  }
                >
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={props.state.pending}
                    onClick={() => {
                      const tier = props.state.tier;
                      if (tier !== 'free') props.onKeepPlan?.(tier);
                    }}
                  >
                    Keep {PLAN_BY_TIER[props.state.tier].name} plan
                  </Button>
                </Show>
              </div>
            </SettingsCard>
          )}
        </Show>
      </section>

      {props.computers}

      <Show
        when={
          props.state.canChangePlan &&
          props.state.tier !== 'max' &&
          offeredPlans().length > 0 &&
          (props.state.hasPaid || !props.state.existingSubscription)
        }
      >
        <section
          data-settings-target="upgrade"
          tabIndex={-1}
          class="@container/plan-options flex scroll-mt-4 flex-col gap-4 outline-none"
        >
          <h2 class="text-base font-medium text-ink">
            {props.state.hasPaid && props.state.aiUsageEnabled
              ? 'Need more AI?'
              : 'Upgrade'}
          </h2>
          <Show when={props.trialEligibilityFailed}>
            <div
              role="alert"
              class="flex flex-wrap items-center gap-3 text-sm text-ink-muted"
            >
              <p>Couldn't confirm your Pro offer. Please try again.</p>
              <Button
                variant="ghost"
                size="sm"
                onClick={props.onRefreshTrialEligibility}
              >
                Try again
              </Button>
            </div>
          </Show>
          <div
            class="grid grid-cols-1 gap-6"
            classList={{
              '@2xl/plan-options:grid-cols-2': offeredPlans().length === 2,
              '@4xl/plan-options:grid-cols-3': offeredPlans().length === 3,
            }}
          >
            <For each={offeredPlans()}>
              {(plan) => (
                <BillingPlanCard
                  plan={plan}
                  interval={cardInterval(
                    plan,
                    props.state,
                    defaultInterval(plan)
                  )}
                  state={props.state}
                  onSelectPlan={handleSelectPlan}
                />
              )}
            </For>
          </div>
        </section>
      </Show>
      <BillingCycleDialog
        plan={cyclePlan()}
        perSeat={!!props.state.teamRole}
        pending={props.state.pending}
        onClose={() => setCyclePlan(null)}
        onConfirm={(plan, chosen) => {
          setCyclePlan(null);
          props.onSelectPlan(plan, chosen);
        }}
      />
    </SettingsPage>
  );
}
