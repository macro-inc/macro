import type { PaidPlanTier } from '@app/features/paywall/plans';
import { createSignal, onCleanup } from 'solid-js';
import type { OnboardingContext } from '../context/onboarding-context';
import type { CheckoutReturn } from '../core/checkout';

/** Webhook settling can lag the Stripe redirect; poll this long before asking for a retry. */
const LICENSE_POLL_ATTEMPTS = 10;
const LICENSE_POLL_MS = 1_000;

export type PlanState =
  /** No paid license: offer the trial. */
  | { t: 'offer' }
  | { t: 'confirming' }
  /** Paid, or back from checkout: continuing re-checks the license. */
  | { t: 'continue'; stillWaiting: boolean };

/**
 * Stripe owns payment details. A success URL alone is not proof of payment:
 * the flow finishes only once the server reports an active or trialing license.
 */
export function createPlanConfirmation(
  context: Pick<OnboardingContext, 'viewer' | 'refreshViewer' | 'track'>,
  options: {
    checkoutReturn: CheckoutReturn | undefined;
    onConfirmed: (tier: PaidPlanTier) => Promise<void>;
  }
) {
  const returned = options.checkoutReturn?.t === 'success';
  const tier: PaidPlanTier =
    options.checkoutReturn?.t === 'success'
      ? options.checkoutReturn.tier
      : 'premium';
  const licensed = () => {
    const viewer = context.viewer();
    return viewer.t === 'signed-in' && viewer.viewer.licensed;
  };
  const [confirming, setConfirming] = createSignal(returned);
  const [stillWaiting, setStillWaiting] = createSignal(false);
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });

  const confirm = async () => {
    setConfirming(true);
    setStillWaiting(false);
    try {
      for (let attempt = 0; attempt < LICENSE_POLL_ATTEMPTS; attempt++) {
        if (disposed) return;
        const viewer = await context.refreshViewer();
        if (disposed) return;
        if (viewer.t === 'signed-in' && viewer.viewer.licensed) {
          await options.onConfirmed(tier);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, LICENSE_POLL_MS));
      }
      setStillWaiting(true);
    } catch {
      setStillWaiting(true);
    } finally {
      if (!disposed) setConfirming(false);
    }
  };

  if (returned) context.track('subscription_success', { type: tier });
  if (returned || licensed()) void confirm();

  const state = (): PlanState => {
    if (confirming()) return { t: 'confirming' };
    if (returned || licensed())
      return { t: 'continue', stillWaiting: stillWaiting() };
    return { t: 'offer' };
  };

  return { state, confirm };
}
