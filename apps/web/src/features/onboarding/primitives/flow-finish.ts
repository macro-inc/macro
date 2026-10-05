import type { PaidPlanTier, PlanTier } from '@app/features/paywall/plans';
import { type Accessor, createSignal } from 'solid-js';
import type {
  CompletionResult,
  OnboardingContext,
} from '../context/onboarding-context';
import type { CheckoutTerms } from '../core/checkout';
import { afterOnboardingTarget, sanitizeNext } from '../core/next-target';
import { clearFlowProgress, readSavedNext, saveNext } from './flow-storage';

type FinishCapabilities = Pick<
  OnboardingContext,
  'completeOnboarding' | 'startCheckout' | 'track' | 'notifyFailure'
>;

/**
 * The "leave onboarding" workflow: complete onboarding, then land in the app
 * (the preserved `?next` deep link, or Home).
 */
export function createFlowFinish(
  context: FinishCapabilities,
  options: {
    next: Accessor<string | undefined>;
    onNavigate: (target: string) => void;
    /** Leaves the app for hosted checkout. */
    onRedirect: (url: string) => void;
    /** Rollup stamped onto `onboarding_v4_completed`. */
    completionRollup?: () => {
      emails_connected: number;
      connectors_connected: string[];
    };
  }
) {
  const [finishing, setFinishing] = createSignal(false);

  // The inbox-OAuth callback returns to bare /onboarding, so persist the deep
  // link as soon as it is known; it is read again after the round-trip.
  const persistNext = () => {
    const next = sanitizeNext(options.next());
    if (next) saveNext(next);
  };
  persistNext();

  const afterTarget = () =>
    afterOnboardingTarget(options.next(), readSavedNext());

  const trackCompleted = (plan: PlanTier, planSkipped: boolean) => {
    context.track('onboarding_v4_completed', {
      plan,
      plan_skipped: planSkipped,
      emails_connected: 0,
      connectors_connected: [],
      ...options.completionRollup?.(),
    });
  };

  const leave = async (input: {
    skipped: boolean;
    target: string;
    onCompleted: () => void;
  }) => {
    if (finishing()) return;
    setFinishing(true);
    const result = await context
      .completeOnboarding({ skipped: input.skipped })
      .catch((): CompletionResult => ({ t: 'failed' }));
    if (result.t === 'failed') {
      context.notifyFailure("Couldn't finish setup — please try again");
      setFinishing(false);
      return;
    }
    clearFlowProgress();
    input.onCompleted();
    // Stay finishing: the flow now reads as complete, and dropping the flag
    // would let it navigate a second time, after the saved deep link is gone.
    options.onNavigate(input.target);
  };

  // Targets resolve before completing: completion clears the saved deep link.
  const complete = (plan: PlanTier, planSkipped: boolean) =>
    leave({
      skipped: false,
      target: afterTarget(),
      onCompleted: () => trackCompleted(plan, planSkipped),
    });

  /**
   * Hand the page to Stripe WITHOUT completing the flow: both checkout legs
   * return to the plan step, which finishes only once payment is confirmed.
   */
  const startPremiumCheckout = async (
    tier: PaidPlanTier,
    terms: CheckoutTerms = 'trial'
  ) => {
    if (finishing()) return;
    setFinishing(true);
    try {
      const url = await context.startCheckout(tier, terms);
      // Leave `finishing` set: the page is navigating away, and re-enabling
      // the buttons mid-unload invites a double checkout.
      options.onRedirect(url);
    } catch (error) {
      context.notifyFailure(
        error instanceof Error
          ? error.message
          : "Couldn't start checkout — please try again"
      );
      setFinishing(false);
    }
  };

  return {
    finishing,
    afterTarget,
    persistNext,
    /** Finish as a Guest (or with the plan step skipped) and enter the app. */
    finishFree: (planSkipped = false) => complete('free', planSkipped),
    startPremiumCheckout,
    /** Finish after checkout confirmed payment, recording the tier Stripe returned. */
    finishPremium: (tier: PaidPlanTier = 'premium') => complete(tier, false),
    /** Staff escape hatch: leave from any step, recorded server-side as skipped. */
    bypass: (step: string) =>
      leave({
        skipped: true,
        target: afterTarget(),
        onCompleted: () => context.track('onboarding_v4_bypassed', { step }),
      }),
  };
}
