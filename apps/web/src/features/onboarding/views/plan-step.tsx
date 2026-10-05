import type { PaidPlanTier } from '@app/features/paywall/plans';
import { Show } from 'solid-js';
import { match } from 'ts-pattern';
import { ContinueButton } from '../components/controls';
import { useOnboardingContext } from '../context/onboarding-context';
import type { CheckoutReturn } from '../core/checkout';
import { createPlanConfirmation } from '../primitives/plan-confirmation';

/** Stripe owns payment details. Verify the webhook-updated license before leaving setup. */
export function PlanStep(props: {
  checkoutReturn: CheckoutReturn | undefined;
  finishing: boolean;
  onStartCheckout: (tier: PaidPlanTier) => void;
  onPremiumPaid: (tier: PaidPlanTier) => Promise<void>;
}) {
  const context = useOnboardingContext();
  const plan = createPlanConfirmation(context, {
    checkoutReturn: props.checkoutReturn,
    onConfirmed: props.onPremiumPaid,
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
      <Show
        when={(() => {
          const state = plan.state();
          return state.t === 'continue' && state.stillWaiting;
        })()}
      >
        <p role="alert" class="mt-8 text-center text-sm text-ink-muted">
          We're still waiting for payment confirmation. Please try again in a
          moment.
        </p>
      </Show>
      <div class="mt-9">
        <ContinueButton
          label={match(plan.state())
            .with({ t: 'confirming' }, () => 'Confirming your subscription…')
            .otherwise((state) =>
              props.finishing
                ? 'Opening your workspace…'
                : state.t === 'continue'
                  ? 'Continue to workspace'
                  : 'Start 30 day trial'
            )}
          disabled={plan.state().t === 'confirming' || props.finishing}
          onClick={() =>
            plan.state().t === 'offer'
              ? props.onStartCheckout('premium')
              : void plan.confirm()
          }
        />
      </div>
      <Show when={plan.state().t === 'offer'}>
        <p class="mx-auto mt-3 max-w-52 text-center text-xs leading-5 text-ink-extra-muted">
          <span class="block">$40/user/month, billed monthly</span>
          <span class="block">after the trial. Cancel anytime.</span>
        </p>
      </Show>
    </section>
  );
}
