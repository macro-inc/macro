import { createEffect } from 'solid-js';
import UsersIcon from '@icon/regular/users.svg';
import UserIcon from '@icon/regular/user.svg';
import SpinnerIcon from '@icon/regular/spinner.svg';
import type { LessonContentProps, LessonDefinition } from '../types';
import { useOnboarding } from '../onboarding-context';
import { useOnboardingCheckoutMutation } from '../use-onboarding-checkout';
import { useAnalytics } from '@app/component/analytics-context';
import { useIsAuthenticated } from '@core/auth';
import { toast } from '@core/component/Toast/Toast';
import type { PaidPlanTier } from '@app/component/paywall/plans';

function TeamChoiceContent() {
  return (
    <div class="flex flex-col gap-3 onboarding-stagger">
      <p>Choose how you want to use Macro.</p>
    </div>
  );
}

function TeamChoiceDemo(props: LessonContentProps) {
  const onboarding = useOnboarding();
  const analytics = useAnalytics();
  const isAuthenticated = useIsAuthenticated();

  const checkoutMutation = useOnboardingCheckoutMutation({
    onSuccess: (result) => {
      analytics.track('subscription_start', {
        type: onboarding.selectedPlan(),
        seats: 1,
      });
      window.location.href = result.checkoutUrl;
    },
    onError: (error) => {
      console.error('Checkout error:', error);
      toast.failure(
        error.message || 'Failed to start checkout. Please try again.'
      );
    },
  });

  createEffect(() => {
    props.onUnready();
  });

  const handleChooseTeam = () => {
    props.advance();
  };

  const handleChooseSolo = () => {
    const tier = onboarding.selectedPlan();
    if (!tier || tier === 'free' || checkoutMutation.isPending) return;

    if (!isAuthenticated()) {
      toast.failure('Please sign in to continue');
      props.goToLesson('about-us');
      return;
    }

    onboarding.setInvitedMembers([]);
    onboarding.setTeamName('');

    checkoutMutation.mutate({
      tier: tier as PaidPlanTier,
    });
  };

  return (
    <div class="h-full w-full flex items-center justify-center p-12">
        <div class="flex flex-col gap-4 w-full max-w-md">
          <button
            type="button"
            onClick={handleChooseTeam}
            disabled={checkoutMutation.isPending}
            class="flex items-center gap-4 p-5 rounded-md border border-accent/50 bg-accent/5 hover:bg-accent/10 text-left bracket-never focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-panel disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div class="shrink-0 size-11 rounded-full bg-accent/20 flex items-center justify-center">
              <UsersIcon class="size-5 text-accent" />
            </div>
            <div class="flex flex-col gap-0.5">
              <span class="text-base font-semibold text-ink">
                Create a team
              </span>
              <span class="text-sm text-ink/50">
                Collaborate with others in a shared workspace
              </span>
            </div>
          </button>

          <button
            type="button"
            onClick={handleChooseSolo}
            disabled={checkoutMutation.isPending}
            class="flex items-center gap-4 p-5 rounded-md border border-edge bg-panel hover:bg-ink/5 text-left bracket-never focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-panel disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div class="shrink-0 size-11 rounded-full bg-ink/10 flex items-center justify-center">
              {checkoutMutation.isPending ? (
                <SpinnerIcon class="size-5 text-ink/60 animate-spin" />
              ) : (
                <UserIcon class="size-5 text-ink/60" />
              )}
            </div>
            <div class="flex flex-col gap-0.5">
              <span class="text-base font-medium text-ink">Continue solo</span>
              <span class="text-sm text-ink/50">
                Use Macro on your own for now
              </span>
            </div>
          </button>
        </div>
    </div>
  );
}

export const teamChoiceLesson: LessonDefinition = {
  id: 'team-choice',
  title: 'Set up your team',
  content: TeamChoiceContent,
  demo: TeamChoiceDemo,
  order: 89,
  hideContinue: true,
  previousLesson: ({ isLessonSkipped, hasPaidAccess }) => {
    if (isLessonSkipped('choose-plan') || hasPaidAccess) {
      return undefined;
    }
    return 'choose-plan';
  },
};
