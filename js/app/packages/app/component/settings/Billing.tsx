import { useAnalytics } from '@app/component/analytics-context';
import { PLAN_FEATURES, type PlanTier } from '@app/component/paywall/plans';
import { useHasPaidAccess } from '@core/auth';
import CheckIcon from '@phosphor/check.svg';
import { stripeServiceClient } from '@service-stripe/client';
import { Button, Layer, Surface } from '@ui';
import { For, Show } from 'solid-js';

const PlanFeatures = (props: { tier: PlanTier }) => (
  <ul class="grid grid-cols-1 gap-2 text-sm text-ink-muted sm:grid-cols-3">
    <For each={PLAN_FEATURES}>
      {(feature) => (
        <li class="grid grid-cols-[auto_1fr] gap-x-2 rounded-md">
          <CheckIcon class="mt-1 size-3 text-success" />
          <span class="text-ink">{feature.label}</span>
          <span class="col-start-2 text-ink-extra-muted text-sm">
            {feature.values[props.tier]}
          </span>
        </li>
      )}
    </For>
  </ul>
);

export const Billing = () => {
  const analytics = useAnalytics();
  const hasPaid = useHasPaidAccess();

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
        <h1 class="text-xl text-ink font-medium">Billing</h1>
        <p class="text-ink-extra-muted text-sm">
          For questions about billing, <span class="text-ink">contact us</span>
        </p>
      </header>

      <Surface class="flex flex-col rounded-lg p-4" depth={2}>
        <section class="flex flex-col gap-4">
          <header class="flex items-center gap-2">
            <h1 class="text-base font-medium text-ink">
              <Show when={!hasPaid()} fallback={'Premium'}>
                Free plan
              </Show>
            </h1>

            <Layer depth={3}>
              <span class="text-xs text-ink-muted px-1.5 py-0.5 border border-edge-muted rounded-md bg-active">
                Current
              </span>
            </Layer>
            <Show when={hasPaid()}>
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
          <div class="border-t border-t-edge-muted pt-3">
            <PlanFeatures tier={hasPaid() ? 'premium' : 'free'} />
          </div>
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
                Upgrade
              </Button>
            </header>
            <div class="border-t border-t-edge-muted pt-3">
              <PlanFeatures tier="premium" />
            </div>
          </section>
        </Surface>
      </Show>
    </section>
  );
};
