import { type PaidPlanTier, PLAN_BY_TIER } from '@app/features/paywall/plans';
import { plural } from '@core/util/string';
import EnvelopeIcon from '@phosphor/envelope.svg';
import { Button, Layer } from '@ui';
import { For, type JSX, Match, Show, Switch } from 'solid-js';
import { type BillingState, describeSeatPlans } from '../core/billing-state';
import { SettingsCard, SettingsPage } from '../primitives';
import { BillingPlanCard, PlanFeatures } from './billing-plan-card';

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
                <BillingPlanCard
                  plan={plan}
                  state={props.state}
                  onSelectPlan={props.onSelectPlan}
                />
              )}
            </For>
          </div>
        </section>
      </Show>
    </SettingsPage>
  );
}
