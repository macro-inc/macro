import { createMemo, For, Show } from 'solid-js';
import type { LessonContentProps, LessonDefinition } from '../types';
import { useAnalytics } from '@app/component/analytics-context';
import { toast } from '@core/component/Toast/Toast';
import { Tooltip } from '@core/component/Tooltip';
import { useOnboarding } from '../onboarding-context';
import {
  PLANS,
  PLAN_FEATURES,
  type PaidPlanTier,
} from '@app/component/paywall/plans';
import { useIsAuthenticated } from '@core/auth';
import ArrowLeftIcon from '@icon/regular/arrow-left.svg';
import ArrowRightIcon from '@icon/regular/arrow-right.svg';
import InfoIcon from '@icon/regular/info.svg';
import LockIcon from '@icon/regular/lock.svg';
import { Button } from '@ui/components/Button';
import { useOnboardingCheckoutMutation } from '../use-onboarding-checkout';

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

  const checkoutMutation = useOnboardingCheckoutMutation({
    onSuccess: (result) => {
      analytics.track('subscription_start', {
        type: onboarding.selectedPlan(),
        seats: onboarding.seatCount(),
        teamId: result.teamId,
      });
      if (result.teamId) {
        analytics.track('onboarding_team_created', {
          teamId: result.teamId,
        });
      }
      window.location.href = result.checkoutUrl;
    },
    onError: (error) => {
      console.error('Checkout error:', error);
      toast.failure(
        error.message || 'Failed to start checkout. Please try again.'
      );
    },
  });

  const selectedPlan = () => {
    const tier = onboarding.selectedPlan();
    return PLANS.find((p) => p.tier === tier);
  };

  const hasTeam = () =>
    onboarding.invitedMembers().length > 0 ||
    onboarding.teamName().trim() !== '';

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

  const handleCheckout = () => {
    const tier = onboarding.selectedPlan();
    if (!tier || tier === 'free' || checkoutMutation.isPending) return;

    if (!isAuthenticated()) {
      toast.failure('Please sign in to continue');
      props.goToLesson('about-us');
      return;
    }

    const teamName = onboarding.teamName();
    const members = onboarding
      .invitedMembers()
      .filter((m) => m.tier !== 'free')
      .map((m) => ({ email: m.email, tier: m.tier as PaidPlanTier }));

    checkoutMutation.mutate({
      tier: tier as PaidPlanTier,
      team: teamName ? { name: teamName, members } : undefined,
    });
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
        <div class="w-full max-w-sm flex flex-col gap-6">
          <div class="flex flex-col gap-3">
            <Show when={hasTeam() && onboarding.teamName()}>
              <div class="flex flex-col gap-0.5">
                <span class="text-xs text-ink/40 uppercase tracking-wide">
                  Team
                </span>
                <span class="text-xl font-semibold text-ink">
                  {onboarding.teamName()}
                </span>
              </div>
            </Show>
            <div class="flex items-baseline justify-between">
              <div class="flex items-end gap-1.5">
                <span class="text-4xl font-bold text-accent leading-none">
                  $
                  {hasTeam()
                    ? onboarding.totalCost()
                    : onboarding.userSeatCost()}
                </span>
                <span class="text-ink/50 text-base pb-0.5">/month</span>
              </div>
              <span class="px-2 py-0.5 rounded-xs bg-accent/15 text-accent text-xs font-medium">
                {hasTeam() ? 'Team plan' : selectedPlan()?.name}
              </span>
            </div>
          </div>

          <div class="flex flex-col gap-2 text-sm">
            <div class="flex justify-between py-2 border-b border-ink/10">
              <span class="text-ink/60">
                Your seat · {selectedPlan()?.name}
              </span>
              <span>
                <span class="text-ink">${onboarding.userSeatCost()}</span>
                <span class="text-ink/40"> /month</span>
              </span>
            </div>
            <For each={teamByTier()}>
              {(group) => (
                <div class="flex justify-between py-2 border-b border-ink/10">
                  <span class="text-ink/60">
                    Team · {group.plan.name} × {group.count}
                  </span>
                  <span>
                    <span class="text-ink">${group.plan.price * group.count}</span>
                    <span class="text-ink/40"> /month</span>
                  </span>
                </div>
              )}
            </For>
            <Show when={onboarding.invitedMembers().length > 0}>
              <div class="flex justify-between items-center py-2">
                <span class="text-ink/60 flex items-center gap-1">
                  Total
                  <Tooltip tooltip="Team charges begin when members accept their invite">
                    <InfoIcon class="size-3.5 text-ink/40" />
                  </Tooltip>
                </span>
                <span>
                  <span class="text-ink font-medium">${onboarding.totalCost()}</span>
                  <span class="text-ink/40"> /month</span>
                </span>
              </div>
            </Show>
          </div>

          <Show when={hasTeam()}>
            <div class="flex flex-col gap-2">
              <span class="text-xs text-ink/40 uppercase tracking-wide">
                Invites
              </span>
              <Show
                when={onboarding.invitedMembers().length > 0}
                fallback={
                  <span class="text-sm text-ink/40 italic">
                    No members invited yet
                  </span>
                }
              >
                <div class="flex flex-col gap-1">
                  <For each={onboarding.invitedMembers()}>
                    {(member) => (
                      <span class="text-sm text-ink/70">{member.email}</span>
                    )}
                  </For>
                </div>
              </Show>
              <span class="text-xs text-ink/40">
                You can invite members anytime from Settings
              </span>
            </div>
          </Show>

          <div class="flex flex-col gap-2">
            <span class="text-xs text-ink/40 uppercase tracking-wide">
              What's included
            </span>
            <div class="flex flex-col gap-1">
              <For each={PLAN_FEATURES}>
                {(feature) => (
                  <div class="flex justify-between text-sm">
                    <span class="text-ink/60">{feature.label}</span>
                    <span class="text-ink">
                      {feature.values[onboarding.selectedPlan() ?? 'free']}
                    </span>
                  </div>
                )}
              </For>
            </div>
          </div>

          <div class="flex flex-col gap-2">
            <Button
              variant="accent"
              size="lg"
              onClick={handleCheckout}
              disabled={checkoutMutation.isPending}
              class="w-full rounded-xs"
            >
              {checkoutMutation.isPending
                ? 'Loading...'
                : 'Continue to payment'}
              <ArrowRightIcon class="size-4" />
            </Button>
            <span class="text-xs text-ink/40 flex items-center justify-center gap-1">
              <LockIcon class="size-3" />
              Secure checkout via Stripe
            </span>
          </div>
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
