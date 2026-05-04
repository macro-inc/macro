import { createSignal, createMemo, Show, For } from 'solid-js';
import type { LessonContentProps, LessonDefinition } from '../types';
import { stripeServiceClient } from '@service-stripe/client';
import { useAnalytics } from '@app/component/analytics-context';
import { toast } from '@core/component/Toast/Toast';
import { ROUTER_BASE_CONCAT } from '@app/constants/routerBase';
import { useOnboarding } from '../onboarding-context';
import { PLANS } from '@app/component/paywall/plans';
import { useIsAuthenticated } from '@core/auth';
import ArrowLeftIcon from '@icon/regular/arrow-left.svg';
import { Button } from '@ui/components/Button';

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
  const isAuthenticated = useIsAuthenticated();
  const [loading, setLoading] = createSignal(false);

  const selectedPlan = () => {
    const tier = onboarding.selectedPlan();
    return PLANS.find((p) => p.tier === tier);
  };

  const teamByTier = createMemo(() => {
    const groups: Record<
      string,
      { plan: (typeof PLANS)[number]; count: number }
    > = {};
    for (const member of onboarding.invitedMembers()) {
      const plan = PLANS.find((p) => p.tier === member.tier);
      if (plan) {
        if (groups[member.tier]) {
          groups[member.tier].count++;
        } else {
          groups[member.tier] = { plan, count: 1 };
        }
      }
    }
    return Object.values(groups).sort((a, b) => b.plan.price - a.plan.price);
  });

  const handleCheckout = async () => {
    const tier = onboarding.selectedPlan();
    if (!tier || tier === 'free' || loading()) return;

    if (!isAuthenticated()) {
      toast.failure('Please sign in to continue');
      props.goToLesson('about-us');
      return;
    }

    setLoading(true);
    try {
      const successUrl = `${window.location.origin}${ROUTER_BASE_CONCAT}welcome?subscriptionSuccess=true&type=${tier}`;
      const url = await stripeServiceClient.createCheckoutSession({
        tier,
        successUrl,
      });
      if (!url) {
        throw new Error('No checkout URL returned');
      }
      analytics.track('subscription_start', {
        type: tier,
        seats: onboarding.seatCount(),
      });
      window.location.href = url;
    } catch (error) {
      console.error('Checkout error:', error);
      toast.failure(
        error instanceof Error
          ? error.message
          : 'Failed to start checkout. Please try again.'
      );
      setLoading(false);
    }
  };

  const handleBack = () => {
    props.goToLesson('team-choice');
  };

  return (
    <div class="h-full w-full flex flex-col p-12">
      <button
        type="button"
        onClick={handleBack}
        class="flex items-center gap-1.5 text-sm text-ink/50 hover:text-ink bracket-never focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 rounded-xs w-fit mb-auto"
      >
        <ArrowLeftIcon class="size-4" />
        Back
      </button>
      <div class="flex-1 flex items-center justify-center">
        <div class="w-full max-w-sm flex flex-col items-center text-center gap-8">
          <div class="flex flex-col items-center gap-1">
            <div class="flex items-baseline gap-1">
              <span class="text-5xl font-bold text-ink">
                ${onboarding.totalCost()}
              </span>
              <span class="text-ink/50 text-lg">/mo</span>
            </div>
            <span class="text-ink/40 text-sm">per month</span>
          </div>

          <div class="w-full flex flex-col text-sm">
            <div class="flex justify-between py-3 border-b border-edge-muted">
              <span class="text-ink/60">
                Your seat · {selectedPlan()?.name}
              </span>
              <span class="text-ink">${onboarding.userSeatCost()}/mo</span>
            </div>
            <For each={teamByTier()}>
              {(group) => (
                <div class="flex justify-between py-3 border-b border-edge-muted">
                  <span class="text-ink/60">
                    Team · {group.plan.name} × {group.count}
                  </span>
                  <span class="text-ink">
                    ${group.plan.price * group.count}/mo
                  </span>
                </div>
              )}
            </For>
          </div>

          <Button
            variant="accent"
            size="lg"
            onClick={handleCheckout}
            disabled={loading()}
            class="w-full rounded-xs"
          >
            {loading() ? 'Loading...' : 'Continue to payment'}
          </Button>
        </div>
      </div>
    </div>
  );
}

export const reviewPayLesson: LessonDefinition = {
  id: 'review-pay',
  title: 'Finish setup',
  content: ReviewPayContent,
  demo: ReviewPayDemo,
  order: 95,
  hideContinue: true,
  completeOnParam: 'subscriptionSuccess',
};
