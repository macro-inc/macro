import { useAnalytics } from '@app/component/analytics-context';
import type { PaidPlanTier } from '@app/component/paywall/plans';
import { DEFAULT_ROUTE } from '@app/constants/defaultRoute';
import { useIsAuthenticated } from '@core/auth';
import { useHasPaidAccess } from '@core/auth/license';
import { toast } from '@core/component/Toast/Toast';
import ArrowRightIcon from '@phosphor/arrow-right.svg';
import LockIcon from '@phosphor/lock.svg';
import SpinnerIcon from '@phosphor/spinner.svg';
import { useNavigate } from '@solidjs/router';
import { Button } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import {
  clearPendingTeam,
  savePendingTeam,
  useOnboardingCheckoutMutation,
} from '../../interactive-onboarding/use-onboarding-checkout';
import { useOnboarding } from '../onboarding-context';

interface TeamPlan {
  price: number;
  seats: number;
  tier: PaidPlanTier;
}

const TEAM_PLANS: TeamPlan[] = [
  { price: 100, seats: 3, tier: 'haiku' },
  { price: 500, seats: 6, tier: 'sonnet' },
  { price: 2500, seats: 10, tier: 'opus' },
  { price: 6000, seats: 25, tier: 'opus' },
];

function planForSeatCount(seats: number): TeamPlan {
  return (
    TEAM_PLANS.find((p) => p.seats >= seats) ??
    TEAM_PLANS[TEAM_PLANS.length - 1]
  );
}

export function PaymentStep() {
  const hasPaidAccess = useHasPaidAccess();

  return (
    <Show when={!hasPaidAccess()} fallback={<AlreadyPaidView />}>
      <CheckoutView />
    </Show>
  );
}

function CheckoutView() {
  const ctx = useOnboarding();
  const analytics = useAnalytics();
  const isAuthenticated = useIsAuthenticated();
  const [isRedirecting, setIsRedirecting] = createSignal(false);

  const teamSize = () => 1 + ctx.invitedMembers().length;
  const plan = () => planForSeatCount(teamSize());

  const checkoutMutation = useOnboardingCheckoutMutation({
    onSuccess: (result) => {
      analytics.track('subscription_start', {
        type: plan().tier,
        seats: teamSize(),
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

  const handleCheckout = () => {
    if (isPending()) return;

    if (!isAuthenticated()) {
      toast.failure('Please sign in to continue');
      ctx.setStep(0);
      return;
    }

    const teamName = ctx.teamName();
    const members = ctx
      .invitedMembers()
      .map((m) => ({ email: m.email, tier: plan().tier }));

    if (teamName) {
      savePendingTeam({ name: teamName, members });
    } else {
      clearPendingTeam();
    }

    ctx.setSelectedPlan(plan().tier);
    checkoutMutation.mutate({ tier: plan().tier });
  };

  return (
    <div class="flex flex-col gap-8 w-full">
      <div class="flex flex-col gap-1">
        <h1 class="text-2xl font-semibold text-ink tracking-tight">
          Review your plan
        </h1>
        <p class="text-sm text-ink-disabled">
          Here's a summary of your workspace.
        </p>
      </div>

      <div class="flex flex-col gap-5">
        <Show when={ctx.teamName()}>
          <div>
            <span class="text-xs font-medium text-ink-muted uppercase tracking-wide">
              Team
            </span>
            <p class="text-lg font-semibold text-ink -mt-0.5">
              {ctx.teamName()}
            </p>
          </div>
        </Show>

        <div class="flex items-baseline justify-between pb-4 border-b border-edge-muted">
          <div class="flex items-end gap-1">
            <span class="text-4xl font-bold text-ink leading-none tracking-tight">
              ${plan().price}
            </span>
            <span class="text-ink-muted text-sm pb-0.5">/mo</span>
          </div>
          <span class="text-sm text-ink-muted">Up to {plan().seats} seats</span>
        </div>

        <div class="flex flex-col text-sm">
          <div class="flex justify-between py-2.5 border-b border-edge-muted">
            <span class="text-ink-muted">You</span>
            <span class="text-xs text-ink-disabled">{ctx.email()}</span>
          </div>
          <For each={ctx.invitedMembers()}>
            {(member) => (
              <div class="flex justify-between py-2.5 border-b border-edge-muted">
                <span class="text-ink-muted font-mono text-xs truncate mr-2">
                  {member.email}
                </span>
                <span class="text-xs text-ink-disabled shrink-0">Invited</span>
              </div>
            )}
          </For>
          <div class="flex justify-between items-center py-2.5">
            <span class="text-ink-muted">
              {teamSize()} {teamSize() === 1 ? 'seat' : 'seats'} used
            </span>
            <span class="text-xs text-ink-disabled">
              {plan().seats - teamSize()} remaining
            </span>
          </div>
        </div>
      </div>

      <div class="flex flex-col gap-3">
        <Button
          variant="base"
          size="lg"
          onClick={handleCheckout}
          disabled={isPending()}
          class="w-full bg-accent text-surface border-accent not-disabled:hover:bg-accent/90 not-disabled:hover:text-surface focus-visible:bg-accent focus-visible:text-surface focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-surface"
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
            <ArrowRightIcon class="size-4" />
          </Show>
        </Button>

        <span class="text-xs text-ink-disabled flex items-center justify-center gap-1.5">
          <LockIcon class="size-3" />
          Secure checkout via Stripe
        </span>
      </div>
    </div>
  );
}

function AlreadyPaidView() {
  const navigate = useNavigate();

  const handleTakeMeThere = () => {
    navigate('/component/settings', { replace: true });
  };

  const handleTakeMeHome = () => {
    navigate(DEFAULT_ROUTE, { replace: true });
  };

  return (
    <div class="flex flex-col gap-8 w-full">
      <div class="flex flex-col gap-1">
        <h1 class="text-2xl font-semibold text-ink tracking-tight">
          You're all set
        </h1>
        <p class="text-sm text-ink-disabled">
          You already have an active plan. Invite teammates from Settings
          anytime.
        </p>
      </div>

      <div class="flex flex-col gap-2">
        <Button
          variant="base"
          size="lg"
          onClick={handleTakeMeThere}
          class="w-full bg-accent text-surface border-accent not-disabled:hover:bg-accent/90 not-disabled:hover:text-surface focus-visible:bg-accent focus-visible:text-surface focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-surface"
        >
          Take me there
          <ArrowRightIcon class="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="md"
          onClick={handleTakeMeHome}
          class="w-full"
        >
          Take me home
        </Button>
      </div>
    </div>
  );
}
