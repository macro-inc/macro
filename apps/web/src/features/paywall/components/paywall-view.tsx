import type { PaywallMessageMetadata } from '@core/constant/PaywallState';
import ArrowSquareOutIcon from '@phosphor/arrow-square-out.svg';
import { Button } from '@ui';
import { For, Match, Show, Switch } from 'solid-js';
import { BillingPlanCard } from '../../settings/components/billing-plan-card';
import type { BillingState } from '../../settings/core/billing-state';
import { getUpgradePlans } from '../plans';

export function PaywallView(props: {
  state: BillingState;
  availability: 'loading' | 'error' | 'ready';
  metadata?: PaywallMessageMetadata;
  onDismiss: () => void | Promise<void>;
  onManagePlan: () => void | Promise<void>;
  onRetry: () => void;
}) {
  return (
    <section class="flex w-full flex-col gap-6 p-6 sm:p-8">
      <header class="flex flex-col gap-2">
        <h2 class="text-2xl font-semibold text-ink">
          {props.state.tier === 'max'
            ? 'Manage your plan'
            : props.state.tier === 'premium'
              ? 'Upgrade to Max'
              : 'Upgrade your plan'}
        </h2>
        <p class="text-sm text-ink-extra-muted">
          {props.metadata?.description ?? 'Get more AI power and room to grow.'}
        </p>
        <Show when={props.metadata?.learnMoreUrl}>
          {(url) => (
            <a
              class="inline-flex items-center gap-1 self-start text-xs text-link hover:text-link-hover visited:text-link-visited"
              href={url()}
              target="_blank"
              rel="noopener"
            >
              Learn more about {props.metadata?.learnMoreSubject ?? 'plans'}
              <ArrowSquareOutIcon class="size-4 shrink-0" />
            </a>
          )}
        </Show>
      </header>
      <Switch>
        <Match when={props.availability === 'loading'}>
          <p role="status" class="text-sm text-ink-muted">
            Loading your plans…
          </p>
        </Match>
        <Match when={props.availability === 'error'}>
          <div class="flex flex-col items-start gap-3">
            <p role="alert" class="text-sm text-ink-muted">
              Couldn't load your available plans. Please try again.
            </p>
            <Button size="sm" variant="outline" onClick={props.onRetry}>
              Try again
            </Button>
          </div>
        </Match>
        <Match when={!props.state.canChangePlan}>
          <p class="text-sm text-ink-muted">
            {props.state.teamRole === 'member'
              ? 'Your plan is managed by your team. Contact your team owner to make changes.'
              : 'This account can’t make billing changes.'}
          </p>
        </Match>
        <Match when={props.state.tier === 'max'}>
          <p class="text-sm text-ink-muted">
            You're already on Max, our highest plan.
          </p>
        </Match>
        <Match when={props.availability === 'ready'}>
          <div class="@container/plan-options">
            <div
              class="grid grid-cols-1 gap-6"
              classList={{
                '@2xl/plan-options:grid-cols-2': props.state.tier === 'free',
              }}
            >
              <For each={getUpgradePlans(props.state.tier)}>
                {(plan) => <BillingPlanCard plan={plan} state={props.state} />}
              </For>
            </div>
          </div>
        </Match>
      </Switch>
      <footer class="flex flex-wrap justify-end gap-2 border-t border-edge-muted pt-4">
        <Button
          size="sm"
          variant="ghost"
          disabled={props.state.pending}
          onClick={props.onDismiss}
        >
          Dismiss
        </Button>
        <Button size="sm" variant="cta" onClick={props.onManagePlan}>
          Manage plan
        </Button>
      </footer>
    </section>
  );
}
