import InfoIcon from '@icon/regular/info.svg';
import { createMemo, createSignal, For, Show } from 'solid-js';
import type { LessonContentProps, LessonDefinition } from '../types';
import { useAnalytics } from '@app/component/analytics-context';
import { toast } from '@core/component/Toast/Toast';
import { useOnboarding } from '../onboarding-context';
import {
  PLANS,
  PLAN_FEATURES,
  type PaidPlanTier,
} from '@app/component/paywall/plans';
import { useIsAuthenticated } from '@core/auth';
import ArrowRightIcon from '@icon/regular/arrow-right.svg';
import LockIcon from '@icon/regular/lock.svg';
import { Button } from '@ui/components/Button';
import { cn } from '@ui/utils/classname';
import {
  useOnboardingCheckoutMutation,
  getPendingTeam,
  clearPendingTeam,
  savePendingTeam,
} from '../use-onboarding-checkout';
import { throwOnErr } from '@core/util/maybeResult';
import { authServiceClient } from '@service-auth/client';
import { TeamUserTier } from '@service-auth/generated/schemas/teamUserTier';
import { invalidateUserTeams } from '@queries/team';

function toTeamUserTier(tier: PaidPlanTier): TeamUserTier {
  const map: Record<PaidPlanTier, TeamUserTier> = {
    haiku: TeamUserTier.Haiku,
    sonnet: TeamUserTier.Sonnet,
    opus: TeamUserTier.Opus,
  };
  return map[tier];
}
import { analytics } from '@app/lib/analytics/analytics';
import { Tooltip } from '@core/component/Tooltip';

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
  const [isRedirecting, setIsRedirecting] = createSignal(false);

  // Returns to /welcome?subscriptionSuccess=true on success, which triggers
  // completeOnParam and runs onCompleteParam to create the pending team.
  const checkoutMutation = useOnboardingCheckoutMutation({
    onSuccess: (result) => {
      analytics.track('subscription_start', {
        type: onboarding.selectedPlan(),
        seats: onboarding.seatCount(),
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
    const order: string[] = [];
    for (const member of onboarding.invitedMembers()) {
      const plan = PLANS.find((p) => p.tier === member.tier);
      if (plan) {
        if (groups[member.tier]) {
          groups[member.tier].count++;
        } else {
          groups[member.tier] = { plan, count: 1 };
          order.push(member.tier);
        }
      }
    }
    return order.map((tier) => groups[tier]);
  });

  const handleCheckout = () => {
    const tier = onboarding.selectedPlan();
    if (!tier || tier === 'free' || isPending()) return;

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

    if (teamName) {
      savePendingTeam({ name: teamName, members });
    } else {
      clearPendingTeam();
    }

    checkoutMutation.mutate({ tier: tier as PaidPlanTier });
  };

  return (
    <div class="h-full w-full flex items-start justify-center p-12 pt-[12%]">
      <Show
        when={hasTeam()}
        fallback={
          /* Solo layout */
          <div class="w-full max-w-md flex flex-col">
            {/* Price */}
            <div class="px-5 py-4 border-b border-edge flex items-baseline justify-between">
              <div class="flex items-end gap-1.5">
                <span class="text-4xl font-bold text-ink leading-none">
                  ${onboarding.userSeatCost()}
                </span>
                <span class="text-ink/50 text-base pb-0.5">/month</span>
              </div>
              <span class="px-2 py-0.5 rounded-xs bg-accent/15 text-accent text-xs font-medium">
                {selectedPlan()?.name}
              </span>
            </div>

            {/* What's included */}
            <div class="px-5 py-4 border-b border-edge">
              <span class="text-xs text-ink/40 uppercase tracking-wide">
                What's included
              </span>
              <div class="flex flex-col gap-1 mt-2">
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

            {/* CTA */}
            <div class="px-5 py-4 flex flex-col gap-2 mt-auto">
              <Button
                variant="active"
                size="lg"
                onClick={handleCheckout}
                disabled={isPending()}
                class="w-full rounded-xs"
              >
                {isPending()
                  ? 'Redirecting to checkout…'
                  : 'Continue to payment'}
                <Show when={!isPending()}>
                  <ArrowRightIcon class="size-4" />
                </Show>
              </Button>
              <span class="text-xs text-ink/40 flex items-center justify-center gap-1">
                <LockIcon class="size-3" />
                Secure checkout via Stripe
              </span>
            </div>
          </div>
        }
      >
        {/* Team layout */}
        <div class="w-full max-w-md">
          {/* Header */}
          <Show when={onboarding.teamName()}>
            <div class="mb-1">
              <span class="text-xs text-ink/40 uppercase tracking-wide">
                Team
              </span>
              <p class="text-lg font-semibold text-ink -mt-0.5">
                {onboarding.teamName()}
              </p>
            </div>
          </Show>

          {/* Price */}
          <div class="pb-4 border-b border-ink/10 flex items-baseline justify-between">
            <div class="flex items-end gap-1.5">
              <span class="text-4xl font-bold text-ink leading-none">
                ${onboarding.totalCost()}
              </span>
              <span class="text-ink/50 text-base pb-0.5">/month</span>
            </div>
            <span class="px-2 py-0.5 rounded-xs bg-accent/15 text-accent text-xs font-medium">
              Team plan
            </span>
          </div>

          {/* Summary */}
          <div class="py-4 border-b border-ink/10">
            <span class="text-xs text-ink/40 uppercase tracking-wide">
              Summary
            </span>
            <div class="flex flex-col text-sm mt-2">
              <div
                class={cn(
                  'flex justify-between py-2',
                  onboarding.invitedMembers().length > 0 &&
                    'border-b border-ink/10'
                )}
              >
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
                    <Tooltip tooltip="Charged when invite is accepted">
                      <span class="underline decoration-dotted underline-offset-4 italic cursor-help">
                        <span class="text-ink">
                          ${group.plan.price * group.count}
                        </span>
                        <span class="text-ink/40"> /month</span>
                      </span>
                    </Tooltip>
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
                    <span class="text-ink font-medium">
                      ${onboarding.totalCost()}
                    </span>
                    <span class="text-ink/40"> /month</span>
                  </span>
                </div>
              </Show>
            </div>

            {/* What's included - inline when no invites */}
            <Show when={onboarding.invitedMembers().length === 0}>
              <div class="mt-4 pt-4 border-t border-ink/10">
                <span class="text-xs text-ink/40 uppercase tracking-wide">
                  What's included
                </span>
                <div class="flex flex-col gap-1 mt-2">
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
            </Show>
          </div>

          {/* Invites */}
          <Show when={onboarding.invitedMembers().length > 0}>
            <div class="py-4 border-b border-ink/10">
              <span class="text-xs text-ink/40 uppercase tracking-wide">
                Invites ({onboarding.invitedMembers().length})
              </span>
              <div class="flex flex-col gap-1.5 mt-2">
                <For each={onboarding.invitedMembers()}>
                  {(member) => (
                    <div class="flex items-center justify-between text-sm">
                      <span class="text-ink/70 truncate mr-2">
                        {member.email}
                      </span>
                      <span class="text-xs text-ink/40 shrink-0">
                        {PLANS.find((p) => p.tier === member.tier)?.name}
                      </span>
                    </div>
                  )}
                </For>
              </div>
              <p class="text-xs text-ink/40 pt-2">
                You can invite more from Settings
              </p>
            </div>
          </Show>

          {/* CTA */}
          <div class="pt-4 flex flex-col gap-2">
            <Button
              variant="active"
              size="lg"
              onClick={handleCheckout}
              disabled={isPending()}
              class="w-full rounded-xs"
            >
              {isPending() ? 'Redirecting to checkout…' : 'Continue to payment'}
              <Show when={!isPending()}>
                <ArrowRightIcon class="size-4" />
              </Show>
            </Button>
            <span class="text-xs text-ink/40 flex items-center justify-center gap-1">
              <LockIcon class="size-3" />
              Secure checkout via Stripe
            </span>
          </div>
        </div>
      </Show>
    </div>
  );
}

async function createPendingTeamOnReturn(): Promise<boolean> {
  const pendingTeam = getPendingTeam();
  if (!pendingTeam) return true;

  try {
    const team = await throwOnErr(() =>
      authServiceClient.createTeam({ name: pendingTeam.name })
    );

    const invites = pendingTeam.members
      .filter((m) => m.email.trim())
      .map((m) => ({ email: m.email, tier: toTeamUserTier(m.tier) }));

    if (invites.length > 0) {
      await throwOnErr(() =>
        authServiceClient.inviteToTeam(team.id, { invites })
      );
    }

    await invalidateUserTeams();
    clearPendingTeam();

    analytics.track('onboarding_team_created', {
      inviteCount: invites.length,
      teamId: team.id,
    });

    return true;
  } catch (error) {
    console.error('Failed to create team:', error);
    clearPendingTeam();
    return true;
  }
}

export const reviewPayLesson: LessonDefinition = {
  id: 'review-pay',
  title: 'Finish setup',
  content: ReviewPayContent,
  demo: ReviewPayDemo,
  order: 95,
  hideContinue: true,
  previousLesson: ({ onboarding, isLessonSkipped }) => {
    // When teams feature is disabled, these lessons are skipped
    if (isLessonSkipped('team-choice')) {
      return 'choose-plan';
    }
    const hasTeam =
      onboarding.invitedMembers().length > 0 ||
      onboarding.teamName().trim() !== '';
    return hasTeam ? 'invite-team' : 'team-choice';
  },
  completeOnParam: 'subscriptionSuccess',
  onCompleteParam: createPendingTeamOnReturn,
};
