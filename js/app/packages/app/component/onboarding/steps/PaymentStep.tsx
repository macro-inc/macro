import { useAnalytics } from '@app/component/analytics-context';
import type { PaidPlanTier } from '@app/component/paywall/plans';
import { PLANS } from '@app/component/paywall/plans';
import { useIsAuthenticated } from '@core/auth';
import { toast } from '@core/component/Toast/Toast';
import ArrowRightIcon from '@icon/regular/arrow-right.svg';
import InfoIcon from '@icon/regular/info.svg';
import LockIcon from '@icon/regular/lock.svg';
import SpinnerIcon from '@icon/regular/spinner.svg';
import { Tooltip } from '@ui';
import { createMemo, createSignal, For, onMount, Show } from 'solid-js';
import {
  savePendingTeam,
  clearPendingTeam,
  useOnboardingCheckoutMutation,
} from '../../interactive-onboarding/use-onboarding-checkout';
import { useOnboarding } from '../onboarding-context';

const DEFAULT_TIER: PaidPlanTier = 'opus';

export function PaymentStep() {
  const ctx = useOnboarding();
  const analytics = useAnalytics();
  const isAuthenticated = useIsAuthenticated();
  const [isRedirecting, setIsRedirecting] = createSignal(false);

  onMount(() => {
    if (!ctx.selectedPlan()) {
      ctx.setSelectedPlan(DEFAULT_TIER);
    }
  });

  const checkoutMutation = useOnboardingCheckoutMutation({
    onSuccess: (result) => {
      analytics.track('subscription_start', {
        type: ctx.selectedPlan(),
        seats: ctx.seatCount(),
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
    const tier = ctx.selectedPlan();
    return PLANS.find((p) => p.tier === tier);
  };

  const hasTeam = () =>
    ctx.invitedMembers().length > 0 || ctx.teamName().trim() !== '';

  const teamByTier = createMemo(() => {
    const groups: Record<
      string,
      { plan: (typeof PLANS)[number]; count: number }
    > = {};
    const order: string[] = [];
    for (const member of ctx.invitedMembers()) {
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
    const tier = ctx.selectedPlan();
    if (!tier || isPending()) return;

    if (!isAuthenticated()) {
      toast.failure('Please sign in to continue');
      ctx.setStep(0);
      return;
    }

    const teamName = ctx.teamName();
    const members = ctx
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
    <div class="flex flex-col gap-8 w-full">
      <div class="flex flex-col gap-1">
        <h1 class="text-2xl font-semibold text-ink tracking-tight">
          Review your plan
        </h1>
        <p class="text-sm text-ink-muted">
          Confirm your subscription before checkout.
        </p>
      </div>

      <div class="flex flex-col gap-5">
        <Show when={hasTeam() && ctx.teamName()}>
          <div>
            <span class="text-xs font-medium text-ink-muted uppercase tracking-wide">
              Team
            </span>
            <p class="text-lg font-semibold text-ink -mt-0.5">
              {ctx.teamName()}
            </p>
          </div>
        </Show>

        {/* Price header */}
        <div class="flex items-baseline justify-between pb-4 border-b border-edge-muted">
          <div class="flex items-end gap-1">
            <span class="text-4xl font-bold text-ink leading-none tracking-tight">
              ${hasTeam() ? ctx.totalCost() : ctx.userSeatCost()}
            </span>
            <span class="text-ink-muted text-sm pb-0.5">/mo</span>
          </div>
          <span class="px-2 py-0.5 rounded-sm bg-accent-bg text-accent text-xs font-mono">
            {hasTeam() ? 'Team' : selectedPlan()?.name}
          </span>
        </div>

        {/* Line items */}
        <div class="flex flex-col text-sm">
          <div class="flex justify-between py-2.5 border-b border-edge-muted">
            <span class="text-ink-muted">
              Your seat · {selectedPlan()?.name}
            </span>
            <span class="font-mono text-ink">${ctx.userSeatCost()}</span>
          </div>
          <For each={teamByTier()}>
            {(group) => (
              <div class="flex justify-between py-2.5 border-b border-edge-muted">
                <span class="text-ink-muted">
                  Team · {group.plan.name} × {group.count}
                </span>
                <Tooltip label="Charged when invite is accepted">
                  <span class="font-mono text-ink cursor-help underline decoration-dotted underline-offset-4 decoration-edge-muted">
                    ${group.plan.price * group.count}
                  </span>
                </Tooltip>
              </div>
            )}
          </For>
          <Show when={ctx.invitedMembers().length > 0}>
            <div class="flex justify-between items-center py-2.5">
              <span class="text-ink-muted flex items-center gap-1">
                Total
                <Tooltip label="Team charges begin when members accept their invite">
                  <InfoIcon class="size-3.5 text-ink-disabled" />
                </Tooltip>
              </span>
              <span class="font-mono text-ink font-medium">
                ${ctx.totalCost()}
              </span>
            </div>
          </Show>
        </div>

        {/* Invites */}
        <Show when={ctx.invitedMembers().length > 0}>
          <div class="pt-2">
            <span class="text-xs font-medium text-ink-muted uppercase tracking-wide">
              Invites ({ctx.invitedMembers().length})
            </span>
            <div class="flex flex-col gap-1 mt-2">
              <For each={ctx.invitedMembers()}>
                {(member) => (
                  <div class="flex items-center justify-between text-sm py-1">
                    <span class="text-ink-muted truncate mr-2 font-mono text-xs">
                      {member.email}
                    </span>
                    <span class="text-xs text-ink-disabled shrink-0">
                      {PLANS.find((p) => p.tier === member.tier)?.name}
                    </span>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>
      </div>

      <div class="flex flex-col gap-3">
        <button
          type="button"
          onClick={handleCheckout}
          disabled={isPending()}
          class="group w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-sm bg-accent text-surface border border-accent hover:bg-accent/90 transition-colors disabled:opacity-30 disabled:cursor-not-allowed outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          <Show
            when={!isPending()}
            fallback={
              <>
                <SpinnerIcon class="size-4 animate-spin" />
                Redirecting to checkout...
              </>
            }
          >
            Continue to payment
            <ArrowRightIcon class="size-4 transition-transform group-hover:translate-x-0.5" />
          </Show>
        </button>

        <span class="text-xs text-ink-disabled flex items-center justify-center gap-1.5">
          <LockIcon class="size-3" />
          Secure checkout via Stripe
        </span>
      </div>
    </div>
  );
}
