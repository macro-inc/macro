import { useHasPaidAccess } from '@core/auth';
import { type PaywallKey, PaywallMessages } from '@core/constant/PaywallState';
import IconX from '@icon/regular/x.svg';
import { stripeServiceClient } from '@service-stripe/client';
import { createSignal, For, Show } from 'solid-js';
import { useAnalytics } from '@app/component/analytics-context';

const PLANS = [
  {
    tier: 'haiku' as const,
    name: 'Haiku',
    price: 20,
    description: "Access to Anthropic's fast, lightweight model",
    calls: '1,000',
  },
  {
    tier: 'sonnet' as const,
    name: 'Sonnet',
    price: 60,
    description: "Access to Anthropic's balanced frontier model",
    calls: '5,000',
    popular: true,
  },
  {
    tier: 'opus' as const,
    name: 'Opus',
    price: 120,
    description: "Access to Anthropic's most capable model",
    calls: 'Unlimited',
  },
];

interface PaywallComponent {
  cb: () => Promise<void> | void;
  handleGuest?: () => void;
  isOnboarding?: boolean;
  errorKey?: PaywallKey | null;
  customType?: string;
  hideCloseButton?: boolean;
}

const PaywallComponent = (props: PaywallComponent) => {
  const analytics = useAnalytics();

  const [selectedTier, setSelectedTier] = createSignal<string>('sonnet');
  const hasPaid = useHasPaidAccess();

  const handleCheckout = async (tier: string) => {
    try {
      await props.cb();
      const url = await stripeServiceClient.createCheckoutSession(
        props.customType ? props.customType : (props.errorKey ?? undefined),
        undefined,
        tier
      );
      analytics.track('subscription_start', {
        type: tier,
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
    handleCheckout(selectedTier());
  };

  return (
    <div class="space-y-6 sm:space-y-8 w-full">
      <div class="relative w-full text-center">
        <Show when={!props.hideCloseButton}>
          <button
            onClick={props.cb}
            class="fixed top-6 right-6 sm:top-3 sm:right-3 text-ink-extra-muted hover:text-ink transition-colors"
          >
            <IconX class="w-5 sm:w-6 h-5 sm:h-6" />
          </button>
        </Show>
        <Show when={!hasPaid()}>
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
        </Show>
      </div>

      <div class="mx-auto mt-6 w-full max-w-2xl">
        <div class="gap-3 sm:gap-4 grid grid-cols-1 sm:grid-cols-3">
          <For each={PLANS}>
            {(plan) => (
              <button
                inert={hasPaid()}
                onClick={() => setSelectedTier(plan.tier)}
                class="p-4 sm:p-5 border flex flex-col transition-all relative text-left"
                classList={{
                  'border-accent ring-1 ring-accent bg-active':
                    selectedTier() === plan.tier,
                  'border-edge hover:border-edge': selectedTier() !== plan.tier,
                }}
                style={{ 'border-radius': '2px' }}
              >
                <div class="flex flex-col gap-3 w-full">
                  <div class="flex justify-between items-start">
                    <div>
                      <div class="font-semibold text-ink text-base sm:text-lg">
                        {plan.name}
                      </div>
                      <p class="text-sm text-ink/50 mt-0.5">
                        {plan.description}
                      </p>
                    </div>
                    {selectedTier() === plan.tier && (
                      <div class="bg-accent w-3 sm:w-4 h-3 sm:h-4 shrink-0"></div>
                    )}
                  </div>
                  <div class="flex items-baseline gap-0.5">
                    <span class="text-3xl font-bold text-ink">
                      ${plan.price}
                    </span>
                    <span class="text-base text-ink/40">/mo</span>
                  </div>
                  <div class="text-sm text-ink/60">
                    <span class="font-semibold text-ink">{plan.calls}</span> AI
                    tool calls
                  </div>
                  <Show when={plan.popular}>
                    <span class="text-[10px] font-semibold text-accent">
                      Most popular
                    </span>
                  </Show>
                </div>
              </button>
            )}
          </For>
        </div>
      </div>

      <div class="mx-auto mt-8 max-w-2xl text-center">
        <button
          onClick={handleContinue}
          class={`w-full px-4 py-2 sm:px-6 sm:py-3 font-medium transition-none hover:transition text-sm sm:text-base border border-transparent ${
            hasPaid()
              ? 'bg-active text-ink border-edge hover:bg-hover hover:border-edge'
              : 'bg-accent text-page hover:bg-accent-ink'
          }`}
        >
          <Show when={!hasPaid()} fallback={'Manage Subscription'}>
            Get {PLANS.find((p) => p.tier === selectedTier())?.name}
          </Show>
        </button>
        <Show when={!hasPaid() && props.handleGuest}>
          <button
            onClick={() => props.handleGuest?.()}
            class="mt-3 text-xs text-ink/40 hover:text-ink/60 underline"
          >
            Continue with free plan
          </button>
        </Show>
      </div>
    </div>
  );
};

export default PaywallComponent;
