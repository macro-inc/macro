import { onMount, createSignal } from 'solid-js';
import type { LessonContentProps, LessonDefinition } from '../types';
import { stripeServiceClient } from '@service-stripe/client';
import { useAnalytics } from '@app/component/analytics-context';
import { toast } from '@core/component/Toast/Toast';
import { PlanGrid } from '@app/component/paywall/PlanGrid';

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
      <PlanGrid
        footer={(plan) => (
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
                'bg-accent text-panel': !!plan.highlighted,
                'bg-ink/8 text-ink hover:bg-ink/12': !plan.highlighted,
                'opacity-60': loading() !== null,
              }}
            >
              {loading() === plan.tier ? 'Loading...' : `Get ${plan.name}`}
            </button>
          </div>
        )}
      />
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
