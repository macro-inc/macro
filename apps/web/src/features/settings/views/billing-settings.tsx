import CalendarIcon from '@phosphor/calendar-blank.svg';
import CheckIcon from '@phosphor/check.svg';
import EnvelopeIcon from '@phosphor/envelope.svg';
import type { PaidPlan } from '@service-auth/ai-billing-types';
import { Button, Layer } from '@ui';
import { For, Match, Show, Switch } from 'solid-js';
import {
  PLAN_BY_TIER,
  PLAN_USAGE_LABELS,
  type PlanTier,
} from '../../paywall/plans';
import type { BillingContext } from '../context/billing-context';
import { SettingsCard, SettingsPage, SettingsSection } from '../primitives';

/**
 * Plan bullet points. The allowance line appears only with AI usage billing on
 * and describes usage relative to Pro.
 */
const BILLING_PLAN_FEATURES: Record<
  PlanTier,
  (usage: string | undefined) => string[]
> = {
  free: (usage) => [
    'Access to Haiku',
    ...(usage ? [usage] : []),
    'MCP access',
    '5 GB storage',
  ],
  premium: (usage) => [
    'All agents',
    'All models',
    ...(usage ? [usage] : []),
    'No watermark',
    'AI projections',
    'Multiple email inboxes',
    'Calls',
    'Teams',
    '1 TB storage',
  ],
  max: (usage) => [
    'Everything in Pro',
    ...(usage ? [usage] : []),
    'Priority support',
  ],
};

const PlanFeatures = (props: { tier: PlanTier; aiUsageBilling: boolean }) => {
  const allowance = () =>
    props.aiUsageBilling ? PLAN_USAGE_LABELS[props.tier] : undefined;
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

const PlanPrice = (props: { tier: PaidPlan; aiUsageBilling: boolean }) => {
  return (
    <p class="text-ink-extra-muted text-xs">
      ${PLAN_BY_TIER[props.tier].price} per seat / month
      <Show when={props.aiUsageBilling}>
        <Show when={props.tier === 'max'}> · 10× usage</Show>
      </Show>
    </p>
  );
};

export const BillingSettingsView = (props: { context: BillingContext }) => {
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
    const change = props.context.scheduledChange();
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
      <SettingsSection title="Subscription">
        <SettingsCard>
          <section class="flex flex-col gap-4 p-4">
            <header class="flex items-center gap-2">
              <div class="flex flex-col gap-1">
                <div class="flex items-center gap-2">
                  <h2 class="text-lg font-medium text-ink">
                    {PLAN_BY_TIER[props.context.tier()].name} plan
                  </h2>

                  <Layer depth={3}>
                    <span class="text-xs text-ink-muted px-1.5 py-0.25 border border-edge-muted rounded-md bg-active">
                      Current
                    </span>
                  </Layer>
                </div>
                <Switch>
                  <Match
                    when={
                      props.context.teamRole() === 'member' &&
                      props.context.billedThroughTeam()
                    }
                  >
                    <p class="text-ink-extra-muted text-xs">
                      Your seat is billed through your team. Team admins choose
                      each seat's plan in{' '}
                      <a
                        class="text-link hover:text-link-hover"
                        href="/app/settings/team"
                        onClick={(event) => {
                          if (!props.context.openTeamSettings) return;
                          event.preventDefault();
                          props.context.openTeamSettings();
                        }}
                      >
                        Team settings
                      </a>
                      .
                    </p>
                  </Match>
                  <Match
                    when={
                      props.context.hasPaid() &&
                      props.context.teamRole() === 'owner' &&
                      props.context.teamSeatDescription()
                    }
                  >
                    {(description) => (
                      <p class="text-ink-extra-muted text-xs">
                        {description()} • set each seat's plan in{' '}
                        <a
                          class="text-link hover:text-link-hover"
                          href="/app/settings/team"
                          onClick={(event) => {
                            if (!props.context.openTeamSettings) return;
                            event.preventDefault();
                            props.context.openTeamSettings();
                          }}
                        >
                          Team settings
                        </a>
                      </p>
                    )}
                  </Match>
                </Switch>
                <Show
                  when={
                    props.context.hasPaid() &&
                    formatDate(props.context.renewalDate())
                  }
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
                  props.context.canManageSubscription() &&
                  props.context.hasPaid() &&
                  props.context.isOwnerOrSolo()
                }
              >
                <Button
                  class="ml-auto bg-active"
                  size="sm"
                  depth={2}
                  variant="outline"
                  onClick={() => void props.context.manage()}
                >
                  Manage
                </Button>
              </Show>
            </header>
            <ul class="border-t border-t-edge-muted pt-4 flex flex-wrap gap-4 text-sm text-ink-muted">
              <PlanFeatures
                tier={props.context.tier()}
                aiUsageBilling={props.context.aiUsageBilling()}
              />
            </ul>
          </section>
        </SettingsCard>
        <Show when={props.context.subscriptionStatusFailed?.()}>
          <div
            class="flex flex-wrap items-center gap-3 px-4 text-xs text-ink-muted"
            role="status"
          >
            <p>Couldn't load your renewal details.</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={props.context.refreshStatus}
            >
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
                    props.context.canChangePlan() &&
                    props.context.tier() !== 'free'
                  }
                >
                  <Button
                    variant="outline"
                    size="sm"
                    depth={2}
                    disabled={props.context.changingPlan()}
                    onClick={() => {
                      const tier = props.context.tier();
                      if (tier !== 'free') void props.context.changePlan(tier);
                    }}
                  >
                    Keep {PLAN_BY_TIER[props.context.tier()].name} plan
                  </Button>
                </Show>
              </div>
            </SettingsCard>
          )}
        </Show>
      </SettingsSection>

      <Show when={props.context.canChangePlan()}>
        <Switch>
          <Match when={!props.context.hasPaid()}>
            <SettingsSection title="Upgrade">
              <SettingsCard>
                <section class="flex flex-col gap-4 p-4">
                  <header class="flex items-center gap-2">
                    <div class="flex flex-col">
                      <h2 class="text-lg font-medium text-ink">Pro</h2>
                      <PlanPrice
                        tier="premium"
                        aiUsageBilling={props.context.aiUsageBilling()}
                      />
                    </div>
                    <Button
                      class="ml-auto py-1.5 px-3"
                      depth={2}
                      variant="cta"
                      onClick={() => void props.context.checkout('premium')}
                    >
                      Upgrade now
                    </Button>
                  </header>
                  <ul class="border-t border-t-edge-muted pt-4 flex flex-wrap gap-4 text-sm text-ink-muted">
                    <PlanFeatures
                      tier="premium"
                      aiUsageBilling={props.context.aiUsageBilling()}
                    />
                  </ul>
                </section>
              </SettingsCard>
              <SettingsCard>
                <section class="flex flex-col gap-4 p-4">
                  <header class="flex items-center gap-2">
                    <div class="flex flex-col">
                      <h2 class="text-lg font-medium text-ink">Max</h2>
                      <PlanPrice
                        tier="max"
                        aiUsageBilling={props.context.aiUsageBilling()}
                      />
                    </div>
                    <Button
                      class="ml-auto py-1.5 px-3"
                      depth={2}
                      variant="outline"
                      onClick={() => void props.context.checkout('max')}
                    >
                      Get Max
                    </Button>
                  </header>
                  <ul class="border-t border-t-edge-muted pt-4 flex flex-wrap gap-4 text-sm text-ink-muted">
                    <PlanFeatures
                      tier="max"
                      aiUsageBilling={props.context.aiUsageBilling()}
                    />
                  </ul>
                </section>
              </SettingsCard>
            </SettingsSection>
          </Match>
          <Match when={props.context.tier() === 'premium'}>
            <SettingsSection
              title={
                props.context.aiUsageBilling() ? 'Need more AI?' : 'Upgrade'
              }
            >
              <SettingsCard>
                <section class="flex flex-col gap-4 p-4">
                  <header class="flex items-center gap-2">
                    <div class="flex flex-col">
                      <h2 class="text-lg font-medium text-ink">Max</h2>
                      <PlanPrice
                        tier="max"
                        aiUsageBilling={props.context.aiUsageBilling()}
                      />
                    </div>
                    <Button
                      class="ml-auto py-1.5 px-3"
                      depth={2}
                      variant="cta"
                      disabled={props.context.changingPlan()}
                      onClick={() => void props.context.changePlan('max')}
                    >
                      Upgrade to Max
                    </Button>
                  </header>
                  <ul class="border-t border-t-edge-muted pt-4 flex flex-wrap gap-4 text-sm text-ink-muted">
                    <PlanFeatures
                      tier="max"
                      aiUsageBilling={props.context.aiUsageBilling()}
                    />
                  </ul>
                  <p class="text-xs text-ink-extra-muted">
                    Prorated for the rest of this period.
                    <Show when={props.context.teamRole() === 'owner'}>
                      {' '}
                      This moves only your seat; teammates' plans are set per
                      seat in Team settings.
                    </Show>
                  </p>
                </section>
              </SettingsCard>
            </SettingsSection>
          </Match>
        </Switch>
      </Show>
    </SettingsPage>
  );
};
