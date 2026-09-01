import {
  PLAN_FEATURES,
  PLANS,
  type PlanTier,
} from '@app/features/paywall/plans';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import ArrowRight from '@phosphor/arrow-right.svg';
import Check from '@phosphor/check.svg';
import { useUserInfoQuery } from '@queries/auth/user-info';
import { useSearchParams } from '@solidjs/router';
import { Button, cn } from '@ui';
import { createSignal, Index, onCleanup, onMount, Show } from 'solid-js';
import { SkipButton } from './shared';

// The license flips via Stripe webhook after checkout; poll briefly so the
// app already reflects Premium when the user continues in.
const LICENSE_POLL_ATTEMPTS = 10;
const LICENSE_POLL_INTERVAL_MS = 1_000;

/** Free vs paid. The last step: free/skip finishes immediately; premium
 * round-trips through Stripe checkout (the flow stays incomplete, so both
 * checkout legs land back here) and finishes once payment is confirmed. */
export function PlanStep(props: {
  finishing: boolean;
  onFree: (planSkipped: boolean) => void;
  onStartCheckout: (tier: Exclude<PlanTier, 'free'>) => void;
  onPremiumPaid: () => void;
}) {
  const [searchParams] = useSearchParams();
  const userInfoQuery = useUserInfoQuery();
  const analytics = useAnalytics();
  const [selected, setSelected] = createSignal<PlanTier>('free');

  const returnedFromCheckout = searchParams.subscriptionSuccess === 'true';
  const hasPaidAccess = () =>
    userInfoQuery.data?.licenseStatus === 'active' ||
    userInfoQuery.data?.licenseStatus === 'trialing';
  // Back from a successful checkout, or the license is already active (an
  // abandoned checkout return, or a team/enterprise license) — creating
  // another checkout session for these users would just be rejected.
  const premiumActive = () => returnedFromCheckout || hasPaidAccess();

  onMount(() => {
    if (!returnedFromCheckout) return;
    analytics.track('subscription_success', { type: searchParams.type });
    let cancelled = false;
    onCleanup(() => {
      cancelled = true;
    });
    void (async () => {
      for (let attempt = 0; attempt < LICENSE_POLL_ATTEMPTS; attempt++) {
        if (cancelled || hasPaidAccess()) return;
        await new Promise((resolve) =>
          setTimeout(resolve, LICENSE_POLL_INTERVAL_MS)
        );
        if (cancelled) return;
        await userInfoQuery.refetch().catch(() => {});
      }
    })();
  });

  const finish = () => {
    const tier = selected();
    if (tier === 'free') props.onFree(false);
    else props.onStartCheckout(tier);
  };

  return (
    <Show
      when={!premiumActive()}
      fallback={
        <div class="flex flex-col gap-6">
          <div class="flex flex-col items-start gap-3 rounded-xl border border-edge p-5">
            <span class="flex size-8 items-center justify-center rounded-full bg-accent/15 text-accent">
              <Check class="size-4" />
            </span>
            <div class="flex flex-col gap-1">
              <span class="text-sm font-semibold text-ink">
                {returnedFromCheckout
                  ? 'Payment successful'
                  : 'Premium is already active'}
              </span>
              <p class="text-sm leading-relaxed text-ink-muted">
                {returnedFromCheckout
                  ? 'Premium is now active on your account.'
                  : 'Your account already has Premium access — no payment needed.'}
              </p>
            </div>
          </div>
          <Button
            variant="cta"
            size="xl"
            disabled={props.finishing}
            onClick={() => props.onPremiumPaid()}
          >
            {props.finishing ? 'Setting up your workspace…' : 'Continue'}
            <ArrowRight class="size-5" />
          </Button>
        </div>
      }
    >
      <div class="flex flex-col gap-6">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Index each={PLANS}>
            {(plan) => (
              <button
                type="button"
                onClick={() => setSelected(plan().tier)}
                class={cn(
                  'flex flex-col gap-4 rounded-xl border p-5 text-left transition-colors cursor-default',
                  selected() === plan().tier
                    ? 'border-ink/40 ring-1 ring-ink/20'
                    : 'border-edge hover:border-edge-muted'
                )}
              >
                <div class="flex items-center justify-between">
                  <span class="text-sm font-semibold text-ink">
                    {plan().name}
                  </span>
                  <span
                    class={cn(
                      'flex items-center justify-center size-4 rounded-full border',
                      selected() === plan().tier
                        ? 'border-ink bg-ink text-surface'
                        : 'border-edge'
                    )}
                  >
                    <Show when={selected() === plan().tier}>
                      <Check class="size-3" />
                    </Show>
                  </span>
                </div>
                <div class="flex items-baseline gap-1">
                  <span class="text-2xl font-semibold tracking-tight text-ink">
                    ${plan().price}
                  </span>
                  <span class="text-xs text-ink-muted">
                    {plan().price === 0 ? 'forever' : 'per user / month'}
                  </span>
                </div>
                <ul class="flex flex-col gap-2">
                  <Index each={PLAN_FEATURES}>
                    {(feature) => (
                      <li class="flex items-center justify-between gap-2 text-xs">
                        <span class="text-ink-muted">{feature().label}</span>
                        <span class="text-ink font-medium">
                          {feature().values[plan().tier]}
                        </span>
                      </li>
                    )}
                  </Index>
                </ul>
              </button>
            )}
          </Index>
        </div>

        <div class="flex flex-col gap-3">
          <Button
            variant="cta"
            size="xl"
            disabled={props.finishing}
            onClick={finish}
          >
            {props.finishing
              ? selected() === 'free'
                ? 'Setting up your workspace…'
                : 'Heading to checkout…'
              : `Continue with ${selected() === 'free' ? 'Free' : 'Premium'}`}
            <ArrowRight class="size-5" />
          </Button>
          <SkipButton
            label="Decide later"
            disabled={props.finishing}
            onClick={() => props.onFree(true)}
          />
        </div>
      </div>
    </Show>
  );
}
