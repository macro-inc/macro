import { onMount, createSignal } from 'solid-js';
import type { LessonContentProps, LessonDefinition } from '../types';
import { stripeServiceClient } from '@service-stripe/client';
import { useAnalytics } from '@app/component/analytics-context';
import { toast } from '@core/component/Toast/Toast';
import { PlanGrid } from '@app/component/paywall/PlanGrid';
import { ROUTER_BASE_CONCAT } from '@app/constants/routerBase';

function ChoosePlanContent(props: LessonContentProps) {
  onMount(() => props.onComplete());

  return (
    <div class="flex flex-col gap-3 onboarding-stagger">
      <p>Pick the plan that matches how you want to use Macro.</p>
    </div>
  );
}

function ChoosePlanDemo(props: LessonContentProps) {
  const analytics = useAnalytics();
  const [loading, setLoading] = createSignal<string | null>(null);

  const handleCheckout = async (tier: string) => {
    if (loading()) return;
    if (tier === 'free') {
      // Free bypasses Stripe, so fire subscription_success directly here to
      // stay symmetric with the paid path (which fires it on Stripe return
      // via Root.tsx's ?subscriptionSuccess handler).
      analytics.track('subscription_success', { type: tier });
      // Advance to the launch step rather than leaving onboarding.
      props.advance();
      return;
    }
    setLoading(tier);
    try {
      // Return to the onboarding (not /app) on success so the launch step renders.
      // `subscriptionSuccess` triggers the `completeOnParam` hook on this lesson, which
      // pre-marks choose-plan complete in the state machine — the user lands on launch.
      const successUrl = `${window.location.origin}${ROUTER_BASE_CONCAT}welcome?subscriptionSuccess=true&type=${tier}`;
      const url = await stripeServiceClient.createCheckoutSession({
        tier,
        successUrl,
      });
      analytics.track('subscription_start', { type: tier });
      // Fire the lesson's completion analytics before leaving so the paid path
      // has parity with the free branch. `advance()` also bumps the state machine,
      // but we're redirecting immediately — on return, `completeOnParam` takes over.
      props.advance();
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
            {loading() === plan.tier
              ? 'Loading...'
              : plan.tier === 'free'
                ? 'Start free'
                : 'Subscribe'}
          </button>
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
  completeOnParam: 'subscriptionSuccess',
};
