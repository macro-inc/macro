import { onMount, For, createSignal } from 'solid-js';
import type { LessonContentProps, LessonDefinition } from '../types';
import { stripeServiceClient } from '@service-stripe/client';
import { useAnalytics } from '@app/component/analytics-context';
import { toast } from '@core/component/Toast/Toast';

const PLANS: {
  tier: string;
  name: string;
  price: number;
  description: string;
  calls: string;
  popular?: boolean;
}[] = [
  {
    tier: 'haiku',
    name: 'Haiku',
    price: 20,
    description: "Access to Anthropic's fast, lightweight model",
    calls: '1,000',
  },
  {
    tier: 'sonnet',
    name: 'Sonnet',
    price: 60,
    description: "Access to Anthropic's balanced frontier model",
    calls: '5,000',
    popular: true,
  },
  {
    tier: 'opus',
    name: 'Opus',
    price: 120,
    description: "Access to Anthropic's most capable model",
    calls: 'Unlimited',
  },
];

function ChoosePlanContent(props: LessonContentProps) {
  onMount(() => props.onComplete());

  return (
    <div class="flex flex-col gap-3 onboarding-stagger">
      <p>Pick the plan that works best for your team.</p>
    </div>
  );
}

function ChoosePlanDemo() {
  const analytics = useAnalytics();
  const [loading, setLoading] = createSignal<string | null>(null);

  const handleCheckout = async (tier: string) => {
    if (loading()) return;
    setLoading(tier);
    try {
      const url = await stripeServiceClient.createCheckoutSession(
        '',
        undefined,
        tier
      );
      analytics.track('subscription_start', { type: tier });
      window.location.href = url;
    } catch (error) {
      console.error('Checkout error:', error);
      toast.failure('Failed to start checkout. Please try again.');
      setLoading(null);
    }
  };

  return (
    <div class="h-full w-full flex items-center justify-center px-8">
      <div class="flex gap-4 w-full max-w-2xl items-start">
        <For each={PLANS}>
          {(plan) => (
            <div class="flex-1 flex flex-col">
              {/* Badge row — always reserves the same height so cards align */}
              <div class="h-5 flex items-end justify-start">
                {plan.popular && (
                  <span class="bg-accent text-panel text-[10px] font-semibold px-2 py-0.5 rounded-sm rounded-b-none translate-x-[-1px]">
                    Most popular
                  </span>
                )}
              </div>

              {/* Card */}
              <div
                class="border bg-panel flex flex-col overflow-hidden"
                style={{
                  'border-radius': plan.popular ? '0 2px 2px 2px' : '2px',
                }}
                classList={{
                  'border-accent ring-1 ring-accent': !!plan.popular,
                  'border-edge-muted': !plan.popular,
                }}
              >
                <div class="p-4 flex flex-col gap-3 flex-1">
                  <div>
                    <h3 class="text-xl font-semibold text-ink">{plan.name}</h3>
                    <p class="text-sm text-ink/50 mt-0.5">{plan.description}</p>
                  </div>
                  <div class="flex items-baseline gap-0.5">
                    <span class="text-4xl font-bold text-ink">
                      ${plan.price}
                    </span>
                    <span class="text-base text-ink/40">/mo</span>
                  </div>
                  <div class="text-sm text-ink/60">
                    <span class="font-semibold text-ink">{plan.calls}</span> AI
                    tool calls
                  </div>
                  <div class="mt-auto pt-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCheckout(plan.tier);
                      }}
                      disabled={loading() !== null}
                      class="w-full py-2 rounded-xs text-base font-semibold"
                      classList={{
                        'bg-accent text-panel': !!plan.popular,
                        'bg-ink/8 text-ink hover:bg-ink/12': !plan.popular,
                        'opacity-60': loading() !== null,
                      }}
                    >
                      {loading() === plan.tier
                        ? 'Loading...'
                        : `Get ${plan.name}`}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

export const choosePlanLesson: LessonDefinition = {
  id: 'choose-plan',
  title: 'Choose your plan',
  content: ChoosePlanContent,
  demo: ChoosePlanDemo,
  order: 80,
  hideContinue: true,
};
