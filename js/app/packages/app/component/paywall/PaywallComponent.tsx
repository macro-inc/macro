import { useAnalytics } from '@app/component/analytics-context';
import { useHasPaidAccess } from '@core/auth';
import { type PaywallKey, PaywallMessages } from '@core/constant/PaywallState';
import LogoIcon from '@icon/macro-logo.svg';
import ArrowSquareOutIcon from '@phosphor/arrow-square-out.svg';
import CheckIcon from '@phosphor/check.svg';
import { stripeServiceClient } from '@service-stripe/client';
import { Button } from '@ui';
import { For, Show } from 'solid-js';

export interface PaywallProps {
  cb: () => Promise<void> | void;
  handleGuest?: () => void;
  isOnboarding?: boolean;
  errorKey?: PaywallKey | null;
  customType?: string;
  hideCloseButton?: boolean;
}

const PAYWALL_PREMIUM_FEATURES = [
  'All agents',
  'All models',
  'No watermark',
  'MCP access',
  'AI projections',
  'Multiple email inboxes',
  'Calls',
  'Teams',
  '1 TB storage',
];

const PremiumFeatures = () => (
  <ul class="flex flex-wrap gap-4 text-sm text-ink-muted">
    <For each={PAYWALL_PREMIUM_FEATURES}>
      {(label) => (
        <li class="flex items-center gap-2">
          <CheckIcon class="size-3 text-success" />
          <span class="text-ink-muted text-xs">{label}</span>
        </li>
      )}
    </For>
  </ul>
);

const PaywallComponent = (props: PaywallProps) => {
  const analytics = useAnalytics();
  const hasPaid = useHasPaidAccess();

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
    if (hasPaid()) {
      manageSubscription();
      return;
    }
    handleCheckout();
  };

  const ctaLabel = () => (hasPaid() ? 'Manage Subscription' : 'Upgrade now');
  const paywallMetadata = () =>
    props.errorKey ? PaywallMessages[props.errorKey] : undefined;

  return (
    <section class="relative flex w-full flex-col gap-6">
      <div class="grid grid-cols-1 gap-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] p-6 sm:px-8 sm:pt-8 sm:pb-4">
        <section class="flex flex-col gap-4">
          <div class="flex flex-col gap-2">
            <LogoIcon class="size-8 text-accent" />
            <div class="flex flex-col gap-1">
              <h2 class="text-2xl text-ink font-medium">
                {paywallMetadata()?.title ?? 'Upgrade to Premium'}
              </h2>

              <p class="text-sm text-ink-extra-muted">
                {paywallMetadata()?.description ??
                  'Unlock stronger agents, more context, and the premium tools built for teams.'}
              </p>
            </div>
            <Show when={paywallMetadata()?.learnMoreUrl}>
              {(learnMoreUrl) => (
                <a
                  class="mt-10 inline-flex items-center gap-1 text-sm text-ink-extra-muted hover:text-accent"
                  href={learnMoreUrl()}
                  target="_blank"
                  rel="noopener"
                >
                  Learn more about{' '}
                  {paywallMetadata()?.learnMoreSubject ?? 'Premium'}
                  <ArrowSquareOutIcon class="size-4" />
                </a>
              )}
            </Show>
          </div>
        </section>

        <section class="flex flex-col gap-4 rounded-lg bg-active p-4">
          <div class="flex flex-col">
            <h3 class="text-sm text-ink">Premium features</h3>
          </div>
          <PremiumFeatures />
        </section>
      </div>

      <div class="border-t border-t-edge px-8 py-4 flex flex-col justify-end gap-2 sm:flex-row">
        <Button
          variant="ghost"
          depth={3}
          class="rounded-full sm:w-auto px-3 py-1.5"
          onClick={props.cb}
        >
          Dismiss
        </Button>
        <Button
          variant={hasPaid() ? 'base' : 'cta'}
          class="rounded-full sm:w-auto px-3 py-1.5"
          onClick={handleContinue}
        >
          {ctaLabel()}
        </Button>
      </div>
    </section>
  );
};

export default PaywallComponent;
