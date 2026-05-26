import { useAnalytics } from '@app/component/analytics-context';
import { useHasPaidAccess } from '@core/auth';
import { type PaywallKey, PaywallMessages } from '@core/constant/PaywallState';
import IconX from '@phosphor/x.svg';
import { stripeServiceClient } from '@service-stripe/client';
import { Button, cn } from '@ui';
import { createMemo, createSignal, For, Show } from 'solid-js';
import type { PaywallProps } from './PaywallComponent';
import { NEW_PLANS, PLAN_FEATURES, type PlanTier } from './plans';
import SubscriptionTier from './SubscriptionTier';

const PaywallComponentNew = (props: PaywallProps) => {
  const analytics = useAnalytics();
  const hasPaid = useHasPaidAccess();

  const currentTier = createMemo<PlanTier>(() =>
    hasPaid() ? 'premium' : 'free'
  );

  // `userSelectedTier` is only set when the user explicitly clicks a plan card. Until
  // then the UI reflects `currentTier`. This avoids mirroring derived state into a signal
  // via `createEffect` and sidesteps the briefly-wrong-card window before permissions resolve.
  const [userSelectedTier, setUserSelectedTier] = createSignal<PlanTier | null>(
    null
  );
  const selectedTier = createMemo<PlanTier>(
    () => userSelectedTier() ?? currentTier()
  );

  const handleCheckout = async () => {
    try {
      await props.cb();
      const url = await stripeServiceClient.createCheckoutSessionV2({
        type: props.customType
          ? props.customType
          : (props.errorKey ?? undefined),
      });
      analytics.track('subscription_start', {
        type: 'premium',
        customType: props.customType,
        errorKey: props.errorKey,
      });
      window.location.href = url;
    } catch (error) {
      console.error(error);
    }
  };

  const manageSubscription = async () => {
    try {
      const url = await stripeServiceClient.createPortalSession();
      window.location.href = url;
    } catch (error) {
      console.error(error);
    }
  };

  const handleContinue = () => {
    const tier = selectedTier();
    // Paid users go to the Stripe portal regardless of selection — that's where
    // they cancel (downgrade to free) or manage billing on premium.
    if (hasPaid()) {
      manageSubscription();
      return;
    }
    if (tier === 'free') {
      props.handleGuest?.();
      return;
    }
    handleCheckout();
  };

  const ctaLabel = () => {
    if (hasPaid()) {
      return selectedTier() === 'free' ? 'Downgrade' : 'Manage Subscription';
    }
    if (selectedTier() === 'free') return 'Continue with Free';
    return 'Get Premium';
  };

  return (
    <div class="relative space-y-2 w-full">
      <Show when={!props.hideCloseButton}>
        <button
          onClick={props.cb}
          class="absolute -top-2 -right-2 sm:-top-3 sm:-right-3 text-ink-extra-muted hover:text-ink transition-colors z-10"
        >
          <IconX class="size-5 sm:size-6" />
        </button>
      </Show>
      <Show when={!hasPaid()}>
        <div class="relative w-full text-center">
          <div class="space-y-6 sm:space-y-8">
            <div class="text-center">
              <h2 class="mb-2 font-semibold text-ink text-xl sm:text-2xl">
                Choose your plan
              </h2>
              <Show when={props.errorKey}>
                <p class="mb-4 text-failure-ink text-sm sm:text-base">
                  {PaywallMessages[props.errorKey as PaywallKey]}
                </p>
              </Show>
            </div>
          </div>
        </div>
      </Show>

      <div class="w-full @container">
        <div class="gap-2 grid grid-cols-1 @[400px]:grid-cols-2">
          <For each={NEW_PLANS}>
            {(plan) => (
              <button
                onClick={() => setUserSelectedTier(plan.tier)}
                class={cn(
                  selectedTier() === plan.tier
                    ? 'border-accent bg-active'
                    : 'border-edge hover:border-edge',
                  'p-4 sm:p-5 border flex flex-col transition-all relative text-left rounded-sm'
                )}
              >
                <div class="flex flex-col gap-3 w-full">
                  <div class="flex justify-between items-start">
                    <div class="flex items-center gap-2">
                      <div class="font-semibold text-ink text-base sm:text-lg">
                        {plan.name}
                      </div>
                      <Show when={currentTier() === plan.tier}>
                        <span class="text-xs text-ink/60 px-1.5 py-0.5 border border-edge-muted rounded">
                          Current
                        </span>
                      </Show>
                    </div>
                    <SubscriptionTier
                      class="w-7 shrink-0"
                      tier={plan.tier === 'premium' ? 'premium' : undefined}
                    />
                  </div>
                  <div class="flex items-baseline gap-0.5">
                    <span class="text-3xl font-bold text-ink">
                      ${plan.price}
                    </span>
                    <span class="text-base text-ink/40">/mo</span>
                  </div>
                  <div class="text-sm text-ink/60 flex flex-col gap-1">
                    <For each={PLAN_FEATURES}>
                      {(feature) => (
                        <span>
                          {feature.label}: {feature.values[plan.tier]}
                        </span>
                      )}
                    </For>
                  </div>
                </div>
              </button>
            )}
          </For>
        </div>
      </div>

      <div class="w-full">
        <Button
          onClick={handleContinue}
          variant="base"
          size="lg"
          depth={3}
          class="w-full"
          disabled={
            !hasPaid() && selectedTier() === 'free' && !props.handleGuest
          }
        >
          {ctaLabel()}
        </Button>
      </div>
    </div>
  );
};

export default PaywallComponentNew;
