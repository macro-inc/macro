import type { PaidPlanTier } from '@app/features/paywall/plans';
import { fireAndForget } from '@core/util/fireAndForget';
import { Button } from '@ui';
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
  const trial = context.createTrialEligibility();
  const trialEligible = () => {
    const eligibility = trial.eligibility();
    return eligibility.t === 'ready' && eligibility.value;
  };
  // An invite's free months beat the trial, which would replace them.
  const inviteOffer = () => {
    const state = offer();
    return trial.eligibility().t === 'ready' &&
      !trial.existingSubscription() &&
      plan.state().t === 'offer' &&
      state.t === 'ready'
      ? state.value
      : null;
  };

  const subscriptionOffer = () => (
    <section class="mx-auto flex w-full max-w-lg flex-col py-2 sm:py-4">
      <header class="text-center">
        <h1
          tabindex="-1"
          class="font-[Roboto_Slab_Variable] text-[clamp(1.75rem,8vw,3rem)] font-[315] leading-[1.12] tracking-tight outline-none text-balance"
        >
          {plan.state().t === 'offer'
            ? trial.existingSubscription()
              ? 'Manage your subscription.'
              : trialEligible()
                ? 'Free Claude & GPT for 30 days.'
                : 'Get more with Pro.'
            : 'Your workspace is ready.'}
        </h1>
        <p class="mx-auto mt-6 max-w-[400px] text-sm leading-6 text-ink-muted text-balance sm:text-[15px]">
          {plan.state().t === 'offer'
            ? trial.existingSubscription()
              ? 'You have an existing subscription. Review your subscription and payment details to restore access.'
              : trialEligible()
                ? 'Every feature, every AI model and 100 GB of storage. Your first 30 days are on us, then $40/user/month.'
                : 'Every feature, every AI model and 100 GB of storage. $40/user/month.'
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
                  : trial.existingSubscription()
                    ? 'Manage subscription'
                    : trial.eligibility().t === 'loading'
                      ? 'Loading your Pro offer…'
                      : trialEligible()
                        ? 'Start 30 day trial'
                        : 'Get Pro'
            )}
          // Until the invite lookup settles, starting a trial could skip it.
          disabled={
            plan.state().t === 'confirming' ||
            props.finishing ||
            trial.managing() ||
            (plan.state().t === 'offer' &&
              !trial.existingSubscription() &&
              (offer().t === 'loading' || trial.eligibility().t !== 'ready'))
          }
          onClick={() => {
            if (plan.state().t !== 'offer') {
              fireAndForget(plan.confirm(), 'onboarding');
            } else if (trial.existingSubscription()) {
              fireAndForget(trial.manage(), 'onboarding');
            } else {
              props.onStartCheckout(
                'premium',
                trialEligible() ? 'trial' : 'standard'
              );
            }
          }}
        />
      </div>
      <Show when={plan.state().t === 'offer' && !trial.existingSubscription()}>
        <p class="mx-auto mt-3 max-w-52 text-center text-xs leading-5 text-ink-extra-muted">
          <span class="block">$40/user/month, billed monthly</span>
          <span class="block">
            {trialEligible()
              ? 'after the trial. Cancel anytime.'
              : 'Cancel anytime.'}
          </span>
        </p>
      </Show>
      <Show
        when={
          plan.state().t === 'offer' &&
          !trial.existingSubscription() &&
          trial.eligibility().t === 'error'
        }
      >
        <div role="alert" class="mt-4 text-center text-sm text-ink-muted">
          <p>Couldn't confirm your Pro offer.</p>
          <Button variant="ghost" size="sm" onClick={trial.retry}>
            Try again
          </Button>
        </div>
      </Show>
    </section>
  );

  return (
    <Show when={inviteOffer()} keyed fallback={subscriptionOffer()}>
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
