import { useAnalytics } from '@app/component/analytics-context';
import { useHasPaidAccess } from '@core/auth';
import { stripeServiceClient } from '@service-stripe/client';
import { Button, Layer, Surface } from '@ui';
import { Show } from 'solid-js';

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
        {/* Header */}
        <h1 class="text-xl text-ink font-medium">Billing</h1>
        <p class="text-ink-extra-muted text-sm">
          For questions about billing, <span class="text-ink">contact us</span>
        </p>
      </header>

      <Surface class="flex flex-col rounded-lg p-4" depth={2}>
        {/* Current plan */}
        <section>
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
            <Button
              class="ml-auto rounded-full bg-active"
              size="sm"
              depth={2}
              variant="base"
              onClick={handleManage}
            >
              Manage
            </Button>
          </header>
          <div>{/* Plan details/features with checks */}</div>
        </section>
      </Surface>
      <Show when={!hasPaid()}>
        <Surface class="flex flex-col rounded-lg p-4" depth={2}>
          {/* Upgrade plan and details */}

          <section>
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
            <div>{/* Plan details/features with checks */}</div>
          </section>
        </Surface>
      </Show>
    </section>
  );
};
