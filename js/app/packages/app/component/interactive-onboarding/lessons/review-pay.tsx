import { createSignal, Show } from 'solid-js';
import type { LessonContentProps, LessonDefinition } from '../types';
import { stripeServiceClient } from '@service-stripe/client';
import { useAnalytics } from '@app/component/analytics-context';
import { toast } from '@core/component/Toast/Toast';
import { ROUTER_BASE_CONCAT } from '@app/constants/routerBase';
import { useOnboarding } from '../onboarding-context';
import { PLANS } from '@app/component/paywall/plans';

function ReviewPayContent() {
  return (
    <div class="flex flex-col gap-3 onboarding-stagger">
      <p>Review your plan and complete your subscription.</p>
    </div>
  );
}

function ReviewPayDemo(props: LessonContentProps) {
  const analytics = useAnalytics();
  const onboarding = useOnboarding();
  const [loading, setLoading] = createSignal(false);

  const selectedPlan = () => {
    const tier = onboarding.selectedPlan();
    return PLANS.find((p) => p.tier === tier);
  };

  const handleCheckout = async () => {
    const tier = onboarding.selectedPlan();
    if (!tier || loading()) return;

    setLoading(true);
    try {
      const successUrl = `${window.location.origin}${ROUTER_BASE_CONCAT}welcome?subscriptionSuccess=true&type=${tier}`;
      const url = await stripeServiceClient.createCheckoutSession({
        tier,
        successUrl,
      });
      analytics.track('subscription_start', {
        type: tier,
        seats: onboarding.seatCount(),
      });
      props.advance();
      window.location.href = url;
    } catch (error) {
      console.error('Checkout error:', error);
      toast.failure('Failed to start checkout. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div class="h-full w-full flex items-center justify-center p-12">
      <div class="w-full max-w-md flex flex-col gap-6">
        <div class="flex flex-col gap-4 p-6 rounded-sm border border-edge bg-panel">
          <h3 class="text-lg font-semibold text-ink">Order Summary</h3>

          <div class="flex flex-col gap-3">
            <div class="flex justify-between items-center">
              <span class="text-ink/70">
                Your seat ({selectedPlan()?.name})
              </span>
              <span class="text-ink">${onboarding.userSeatCost()}/mo</span>
            </div>

            <Show when={onboarding.invitedMembers().length > 0}>
              <div class="flex justify-between items-center">
                <span class="text-ink/70">
                  Team ({onboarding.invitedMembers().length}{' '}
                  {onboarding.invitedMembers().length === 1 ? 'seat' : 'seats'})
                </span>
                <span class="text-ink">${onboarding.teamSeatsCost()}/mo</span>
              </div>
            </Show>

            <div class="border-t border-edge pt-3 mt-1">
              <div class="flex justify-between items-center">
                <span class="text-ink font-semibold">Total</span>
                <span class="text-ink font-semibold text-lg">
                  ${onboarding.totalCost()}/mo
                </span>
              </div>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={handleCheckout}
          disabled={loading()}
          class="w-full py-3 rounded-xs text-base font-semibold bg-accent text-panel hover:bg-accent/90 disabled:opacity-60 bracket-never focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-panel transition-colors"
        >
          {loading() ? 'Loading...' : 'Continue to payment'}
        </button>
      </div>
    </div>
  );
}

export const reviewPayLesson: LessonDefinition = {
  id: 'review-pay',
  title: 'Review & Pay',
  content: ReviewPayContent,
  demo: ReviewPayDemo,
  order: 95,
  hideContinue: true,
  completeOnParam: 'subscriptionSuccess',
};
