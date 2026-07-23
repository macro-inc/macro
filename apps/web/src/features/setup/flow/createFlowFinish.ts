import { ROUTER_BASE_CONCAT } from '@app/constants/routerBase';
import type { PaidPlanTier } from '@app/features/paywall/plans';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { toast } from '@core/component/Toast/Toast';
import { authKeys } from '@queries/auth/keys';
import { useCompleteTutorialMutation } from '@queries/auth/tutorial';
import { useUserInfoQuery } from '@queries/auth/user-info';
import { queryClient } from '@queries/client';
import { useCompleteOnboardingMutation } from '@queries/onboarding';
import { stripeServiceClient } from '@service-stripe/client';
import { useNavigate, useSearchParams } from '@solidjs/router';
import { createEffect, createSignal } from 'solid-js';
import { FLOW_NEXT_STORAGE_KEY, FLOW_STEP_STORAGE_KEY } from './shared';

/**
 * The "leave onboarding" workflow: reaching the end of the flow (paying or
 * skipping the plan step) marks onboarding complete server-side — which
 * discards leftover onboarding-staged import candidates — plus the legacy
 * tutorial done (suppressing the old modal), then lands in the app: the deep
 * link the redirect preserved (`?next=`), or home. Imports never block the
 * exit; auto-import keeps landing rows server-side.
 */
export function createFlowFinish(options?: {
  /** Extra analytics context stamped onto `onboarding_v4_completed`. */
  completionRollup?: () => {
    emails_connected: number;
    connectors_connected: string[];
  };
}) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const userInfoQuery = useUserInfoQuery();
  const completeOnboarding = useCompleteOnboardingMutation();
  const completeTutorial = useCompleteTutorialMutation();
  const analytics = useAnalytics();
  const [finishing, setFinishing] = createSignal(false);

  const trackCompleted = (plan: 'free' | 'premium', planSkipped: boolean) => {
    analytics.track('onboarding_v4_completed', {
      plan,
      plan_skipped: planSkipped,
      emails_connected: 0,
      connectors_connected: [],
      ...options?.completionRollup?.(),
    });
  };

  // Same-app relative paths only.
  const sanitizeNext = (value: unknown): string | undefined =>
    typeof value === 'string' &&
    value.startsWith('/') &&
    !value.startsWith('//')
      ? value
      : undefined;

  // The email step's OAuth round-trip leaves and re-enters the app, and its
  // callback returns to bare /onboarding — persist the deep link so it
  // survives the trip.
  createEffect(() => {
    const next = sanitizeNext(searchParams.next);
    if (next) sessionStorage.setItem(FLOW_NEXT_STORAGE_KEY, next);
  });

  // Where to land after the flow: the live ?next, the persisted one, or home.
  const afterTarget = () =>
    sanitizeNext(searchParams.next) ??
    sanitizeNext(sessionStorage.getItem(FLOW_NEXT_STORAGE_KEY)) ??
    '/';

  /**
   * Mark the flow complete and verify it stuck. NewOnboardingRedirect keys
   * off userInfo.tutorialComplete: navigating before the cache reflects the
   * PATCH would bounce straight back here. Refetch and verify — if the PATCH
   * failed (allSettled hides it) or the refetch missed, stay put and let the
   * user retry.
   */
  const completeFlow = async (): Promise<boolean> => {
    const [onboardingResult] = await Promise.allSettled([
      completeOnboarding.mutateAsync({ skipped: false }),
      completeTutorial.mutateAsync(),
    ]);
    // Both halves must land: exiting with the row still active would leave
    // onboarding-staged import candidates undiscarded and the flow
    // resumable after the user believes it finished.
    if (onboardingResult.status === 'rejected') {
      toast.failure("Couldn't finish setup — please try again");
      return false;
    }
    await queryClient
      .refetchQueries({ queryKey: authKeys.userInfo.queryKey })
      .catch(() => {});
    if (userInfoQuery.data?.tutorialComplete !== true) {
      toast.failure("Couldn't finish setup — please try again");
      return false;
    }
    sessionStorage.removeItem(FLOW_STEP_STORAGE_KEY);
    sessionStorage.removeItem(FLOW_NEXT_STORAGE_KEY);
    return true;
  };

  /** Finish on the free plan (or a skipped plan step) and enter the app. */
  const finishFree = async (planSkipped = false) => {
    if (finishing()) return;
    setFinishing(true);
    try {
      if (await completeFlow()) {
        trackCompleted('free', planSkipped);
        navigate(afterTarget(), { replace: true });
      }
    } finally {
      setFinishing(false);
    }
  };

  /**
   * Finish on a paid tier: complete the flow first (the checkout round-trip
   * must not bounce back into onboarding), then hand the page to Stripe.
   * If checkout can't start, the user still lands in the app — they can
   * upgrade from settings anytime.
   */
  const finishPremium = async (tier: PaidPlanTier) => {
    if (finishing()) return;
    setFinishing(true);
    try {
      if (!(await completeFlow())) return;
      trackCompleted('premium', false);
      try {
        // Same success convention as the legacy onboarding checkout:
        // /welcome bounces authenticated users into the app.
        const successUrl = `${window.location.origin}${ROUTER_BASE_CONCAT}welcome?subscriptionSuccess=true&type=${tier}`;
        const checkoutUrl = await stripeServiceClient.createCheckoutSession({
          tier,
          successUrl,
        });
        if (!checkoutUrl) throw new Error('No checkout URL returned');
        window.location.href = checkoutUrl;
      } catch {
        toast.failure(
          "Couldn't start checkout — you can upgrade anytime from settings"
        );
        navigate(afterTarget(), { replace: true });
      }
    } finally {
      setFinishing(false);
    }
  };

  return { finishing, finishFree, finishPremium, afterTarget };
}
