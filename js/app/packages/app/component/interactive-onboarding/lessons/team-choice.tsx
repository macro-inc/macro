import { useAnalytics } from '@app/component/analytics-context';
import type { PaidPlanTier } from '@app/component/paywall/plans';
import { useIsAuthenticated } from '@core/auth';
import { toast } from '@core/component/Toast/Toast';
import ArrowRightIcon from '@icon/regular/arrow-right.svg';
import SpinnerIcon from '@icon/regular/spinner.svg';
import UserIcon from '@icon/regular/user.svg';
import UsersIcon from '@icon/regular/users.svg';
import { createEffect, createSignal } from 'solid-js';
import { useOnboarding } from '../onboarding-context';
import type { LessonContentProps, LessonDefinition } from '../types';
import { useOnboardingCheckoutMutation } from '../use-onboarding-checkout';

function TeamChoiceContent() {
  return (
    <div class="flex flex-col gap-3 onboarding-stagger">
      <p>Continue on your own, or invite your team.</p>
    </div>
  );
}

function TeamChoiceDemo(props: LessonContentProps) {
  const onboarding = useOnboarding();
  const analytics = useAnalytics();
  const isAuthenticated = useIsAuthenticated();
  const [isRedirecting, setIsRedirecting] = createSignal(false);

  // Returns to /welcome?subscriptionSuccess=true on success, which completes
  // all lessons except launch, landing the user on the launch lesson.
  const checkoutMutation = useOnboardingCheckoutMutation({
    onSuccess: (result) => {
      analytics.track('subscription_start', {
        type: onboarding.selectedPlan(),
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

  createEffect(() => {
    props.onUnready();
  });

  const handleChooseTeam = () => {
    props.advance();
  };

  const handleChooseSolo = () => {
    const tier = onboarding.selectedPlan();
    if (!tier || tier === 'free' || isPending()) return;

    if (!isAuthenticated()) {
      props.goToLesson('about-us');
      return;
    }

    analytics.track('onboarding_team_skipped', { plan: tier });

    onboarding.setInvitedMembers([]);
    onboarding.setTeamName('');

    checkoutMutation.mutate({ tier: tier as PaidPlanTier });
  };

  return (
    <div class="size-full flex items-center justify-center p-12">
      <div class="flex flex-col gap-4 w-full max-w-md">
        <button
          type="button"
          onClick={handleChooseTeam}
          disabled={isPending()}
          class="flex items-center gap-4 p-5 rounded-md border border-accent/50 bg-accent/5 hover:bg-accent/10 text-left bracket-never focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <div class="shrink-0 size-11 rounded-full bg-accent/20 flex items-center justify-center">
            <UsersIcon class="size-5 text-accent" />
          </div>
          <div class="flex flex-col gap-0.5">
            <span class="text-base font-semibold text-ink">Create a team</span>
            <span class="text-sm text-ink/50">
              Collaborate with others in a shared workspace
            </span>
          </div>
        </button>

        <button
          type="button"
          onClick={handleChooseSolo}
          disabled={isPending()}
          class="flex items-center gap-4 p-5 rounded-md border border-edge bg-surface hover:bg-ink/5 text-left bracket-never focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <div class="shrink-0 size-11 rounded-full bg-ink/10 flex items-center justify-center">
            {isPending() ? (
              <SpinnerIcon class="size-5 text-ink/60 animate-spin" />
            ) : (
              <UserIcon class="size-5 text-ink/60" />
            )}
          </div>
          <div class="flex-1 flex flex-col gap-0.5">
            <span class="text-base font-medium text-ink">
              {isPending() ? 'Redirecting to checkout…' : 'Continue solo'}
            </span>
            <span class="text-sm text-ink/50">
              {isPending() ? '' : 'Use Macro on your own for now'}
            </span>
          </div>
          <ArrowRightIcon class="size-4 text-ink/50 shrink-0" />
        </button>
      </div>
    </div>
  );
}

export const teamChoiceLesson: LessonDefinition = {
  id: 'team-choice',
  title: 'How will you use Macro?',
  content: TeamChoiceContent,
  demo: TeamChoiceDemo,
  order: 89,
  hideContinue: true,
  completeOnParam: 'subscriptionSuccess',
  previousLesson: ({ isLessonSkipped, hasPaidAccess }) => {
    if (isLessonSkipped('choose-plan') || hasPaidAccess) {
      return undefined;
    }
    return 'choose-plan';
  },
};
