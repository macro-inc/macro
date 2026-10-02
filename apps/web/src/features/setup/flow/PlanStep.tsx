import type { PaidPlanTier } from '@app/features/paywall/plans';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { useUserInfoQuery } from '@queries/auth/user-info';
import { useSearchParams } from '@solidjs/router';
import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { ContinueButton } from '../components/controls';

/** Stripe owns payment details. Verify the webhook-updated license before leaving setup. */
export function PlanStep(props: {
  finishing: boolean;
  onStartCheckout: (tier: PaidPlanTier) => void;
  onPremiumPaid: (tier: PaidPlanTier) => Promise<void>;
}) {
  const [params] = useSearchParams();
  const userInfo = useUserInfoQuery();
  const analytics = useAnalytics();
  const returned = params.subscriptionSuccess === 'true';
  const tier = (): PaidPlanTier => (params.type === 'max' ? 'max' : 'premium');
  const paid = () =>
    userInfo.isSuccess &&
    (userInfo.data?.licenseStatus === 'active' ||
      userInfo.data?.licenseStatus === 'trialing');
  const [checking, setChecking] = createSignal(returned);
  const [confirmationError, setConfirmationError] = createSignal(false);
  let cancelled = false;
  onCleanup(() => {
    cancelled = true;
  });

  const confirm = async () => {
    setChecking(true);
    setConfirmationError(false);
    try {
      for (let attempt = 0; attempt < 10; attempt++) {
        if (cancelled) return;
        const result = await userInfo.refetch();
        if (cancelled) return;
        if (
          result.data?.licenseStatus === 'active' ||
          result.data?.licenseStatus === 'trialing'
        ) {
          await props.onPremiumPaid(tier());
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      setConfirmationError(true);
    } catch {
      setConfirmationError(true);
    } finally {
      if (!cancelled) setChecking(false);
    }
  };
  onMount(() => {
    if (returned) analytics.track('subscription_success', { type: tier() });
    if (returned || paid()) void confirm();
  });

  return (
    <section class="mx-auto flex w-full max-w-lg flex-col py-2 sm:py-4">
      <header class="text-center">
        <h1
          tabindex="-1"
          class="font-[Roboto_Slab_Variable] text-[clamp(1.75rem,8vw,3rem)] font-[315] leading-[1.12] tracking-tight outline-none text-balance"
        >
          Free Claude &amp; GPT for 30 days.
        </h1>
        <p class="mx-auto mt-6 max-w-[400px] text-sm leading-6 text-ink-muted text-balance sm:text-[15px]">
          Every feature, every AI model and 1 TB of storage. Your first 30 days
          on us then $40/user month.
        </p>
      </header>
      <Show when={confirmationError()}>
        <p role="alert" class="mt-8 text-center text-sm text-ink-muted">
          We're still waiting for payment confirmation. Please try again in a
          moment.
        </p>
      </Show>
      <div class="mt-9">
        <ContinueButton
          label={
            checking()
              ? 'Confirming your subscription…'
              : props.finishing
                ? 'Opening your workspace…'
                : returned || paid()
                  ? 'Continue to workspace'
                  : 'Start 30 day trial'
          }
          disabled={checking() || props.finishing}
          onClick={() =>
            returned || paid()
              ? void confirm()
              : props.onStartCheckout('premium')
          }
        />
      </div>
      <Show when={!returned && !paid()}>
        <p class="mx-auto mt-3 max-w-52 text-center text-xs leading-5 text-ink-extra-muted">
          <span class="block">$40/user/month, billed monthly</span>
          <span class="block">after the trial. Cancel anytime.</span>
        </p>
      </Show>
    </section>
  );
}
