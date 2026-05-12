import { useAnalytics } from '@app/component/analytics-context';
import { PlanGrid } from '@app/component/paywall/PlanGrid';
import type { PaidPlanTier, PlanTier } from '@app/component/paywall/plans';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useIsAuthenticated } from '@core/auth';
import { toast } from '@core/component/Toast/Toast';
import { ENABLE_INVITE_TEAM_ONBOARDING_OVERRIDE } from '@core/constant/featureFlags';
import CheckIcon from '@icon/regular/check.svg';
import SpinnerIcon from '@icon/regular/spinner.svg';
import { createSignal, onMount, Show } from 'solid-js';
import { useOnboarding } from '../onboarding-context';
import type { LessonContentProps, LessonDefinition } from '../types';
import { useOnboardingCheckoutMutation } from '../use-onboarding-checkout';

function ChoosePlanContent(props: LessonContentProps) {
  onMount(() => props.onComplete());

  return (
    <div class="flex flex-col gap-3 onboarding-stagger">
      <p>Pick the plan that matches how you want to use Macro.</p>
    </div>
  );
}

function ChoosePlanDemo(props: LessonContentProps) {
  const { selectedPlan, setSelectedPlan } = useOnboarding();
  const analytics = useAnalytics();
  const isAuthenticated = useIsAuthenticated();
  const [isRedirecting, setIsRedirecting] = createSignal(false);

  const inviteTeamEnabled = useFeatureFlag('enable-teams-onboarding', {
    enabledOverride: ENABLE_INVITE_TEAM_ONBOARDING_OVERRIDE,
  });

  // Returns to /welcome?subscriptionSuccess=true on success, which completes
  // all lessons except launch, landing the user on the launch lesson.
  const checkoutMutation = useOnboardingCheckoutMutation({
    onSuccess: (result) => {
      analytics.track('subscription_start', {
        type: selectedPlan(),
        seats: 1,
      });
      setIsRedirecting(true);
      window.location.href = result.checkoutUrl;
    },
    onError: (error) => {
      console.error('Checkout error:', error);
      toast.failure(
        error.message || 'Failed to start checkout. Please try again.'
      );
    },
  });

  const isPending = () => checkoutMutation.isPending || isRedirecting();

  const handleSelectPlan = (tier: PlanTier) => {
    if (isPending()) return;

    setSelectedPlan(tier);

    if (tier === 'free') {
      // Free bypasses Stripe, so fire subscription_success directly here to
      // stay symmetric with the paid path (which fires it on Stripe return
      // via Root.tsx's ?subscriptionSuccess handler).
      analytics.track('subscription_success', { type: tier });
      props.skipLesson('team-choice');
      props.skipLesson('invite-team');
      props.skipLesson('review-pay');
      props.advance();
      return;
    }

    // When teams feature is disabled, go directly to checkout
    if (!inviteTeamEnabled().enabled) {
      if (!isAuthenticated()) {
        props.goToLesson('about-us');
        return;
      }

      props.skipLesson('team-choice');
      props.skipLesson('invite-team');
      props.skipLesson('review-pay');

      checkoutMutation.mutate({ tier: tier as PaidPlanTier });
      return;
    }

    props.advance();
  };

  return (
    <div class="size-full flex items-center justify-center px-8">
      <PlanGrid
        footer={(plan) => (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleSelectPlan(plan.tier);
            }}
            disabled={isPending()}
            class="w-full py-2 rounded-xs text-base font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
            classList={{
              'bg-accent text-panel':
                plan.highlighted && selectedPlan() !== plan.tier,
              'bg-accent/20 text-accent': selectedPlan() === plan.tier,
              'bg-ink/8 text-ink hover:bg-ink/12':
                selectedPlan() !== plan.tier && !plan.highlighted,
            }}
          >
            <Show
              when={isPending() && selectedPlan() === plan.tier}
              fallback={
                <>
                  <Show
                    when={selectedPlan() === plan.tier && plan.tier !== 'free'}
                  >
                    <CheckIcon class="size-4" />
                  </Show>
                  {plan.tier === 'free'
                    ? 'Start free'
                    : selectedPlan() === plan.tier
                      ? 'Selected'
                      : 'Select'}
                </>
              }
            >
              <SpinnerIcon class="size-4 animate-spin" />
              Redirecting…
            </Show>
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
