import type { PaidPlanTier } from '@app/features/paywall/plans';
import { type Accessor, type JSX, Show } from 'solid-js';
import { match } from 'ts-pattern';
import { ContinueButton } from '../components/controls';
import {
  type InviteOffer,
  useOnboardingContext,
} from '../context/onboarding-context';
import type { CheckoutReturn, CheckoutTerms } from '../core/checkout';
import { createPlanConfirmation } from '../primitives/plan-confirmation';

/** The host's panel for an invite promotion, shown in place of the trial offer. */
export type InviteOfferSlot = (
  offer: InviteOffer,
  actions: {
    finishing: Accessor<boolean>;
    onClaim: () => void;
    onContinueFree: () => void;
  }
) => JSX.Element;

/** Stripe owns payment details. Verify the webhook-updated license before leaving setup. */
export function PlanStep(props: {
  checkoutReturn: CheckoutReturn | undefined;
  finishing: boolean;
  onStartCheckout: (tier: PaidPlanTier, terms: CheckoutTerms) => void;
  onPremiumPaid: (tier: PaidPlanTier) => Promise<void>;
  onContinueFree: () => void;
  renderInviteOffer: InviteOfferSlot;
}) {
  const context = useOnboardingContext();
  const plan = createPlanConfirmation(context, {
    checkoutReturn: props.checkoutReturn,
    onConfirmed: props.onPremiumPaid,
  });
  const offer = context.createInviteOffer();
  // An invite's free months beat the trial, which would replace them.
  const inviteOffer = () => {
    const state = offer();
    return plan.state().t === 'offer' && state.t === 'ready'
      ? state.value
      : null;
  };

  const trialOffer = () => (
    <section class="mx-auto flex w-full max-w-lg flex-col py-2 sm:py-4">
      <header class="text-center">
        <h1
          tabindex="-1"
          class="font-[Roboto_Slab_Variable] text-[clamp(1.75rem,8vw,3rem)] font-[315] leading-[1.12] tracking-tight outline-none text-balance"
        >
          {plan.state().t === 'offer'
            ? 'Free Claude & GPT for 30 days.'
            : 'Your workspace is ready.'}
        </h1>
        <p class="mx-auto mt-6 max-w-[400px] text-sm leading-6 text-ink-muted text-balance sm:text-[15px]">
          {plan.state().t === 'offer'
            ? 'Every feature, every AI model and 1 TB of storage. Your first 30 days are on us, then $40/user/month.'
            : "We're confirming your access so you can continue to your workspace."}
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
          // Until the invite lookup settles, starting a trial could skip it.
          disabled={
            plan.state().t === 'confirming' ||
            props.finishing ||
            (plan.state().t === 'offer' && offer().t === 'loading')
          }
          onClick={() =>
            plan.state().t === 'offer'
              ? props.onStartCheckout('premium', 'trial')
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

  return (
    <Show when={inviteOffer()} keyed fallback={trialOffer()}>
      {(invite) =>
        props.renderInviteOffer(invite, {
          finishing: () => props.finishing,
          onClaim: () => props.onStartCheckout('premium', 'invite-offer'),
          onContinueFree: props.onContinueFree,
        })
      }
    </Show>
  );
}
