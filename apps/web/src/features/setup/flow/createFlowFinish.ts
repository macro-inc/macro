import { AFTER_SETUP_ROUTE, DEFAULT_ROUTE } from '@app/constants/defaultRoute';
import { createOnboardingCheckoutSession } from '@app/features/onboarding/use-onboarding-checkout';
import type { PaidPlanTier } from '@app/features/paywall/plans';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { toast } from '@core/component/Toast/Toast';
import { authKeys } from '@queries/auth/keys';
import { useCompleteTutorialMutation } from '@queries/auth/tutorial';
import type { UserInfoData } from '@queries/auth/user-info';
import { queryClient } from '@queries/client';
import { useCompleteOnboardingMutation } from '@queries/onboarding';
import { useNavigate, useSearchParams } from '@solidjs/router';
import { createEffect, createSignal } from 'solid-js';
import { FLOW_NEXT_STORAGE_KEY, FLOW_STEP_STORAGE_KEY } from './shared';

/**
 * The "leave onboarding" workflow: mark onboarding + the legacy tutorial
 * complete, then land in the app (the preserved `?next=` deep link, or
 * the Getting Started checklist). Imports never block the exit;
 * auto-import keeps landing rows server-side.
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

  // Same-app relative paths only. A `next` at the default route is not a
  // real deep link — fall through to the Getting Started checklist.
  const sanitizeNext = (value: unknown): string | undefined =>
    typeof value === 'string' &&
    value.startsWith('/') &&
    !value.startsWith('//') &&
    !value.includes('\\') &&
    !value.startsWith(DEFAULT_ROUTE)
      ? value
      : undefined;

  // The inbox-OAuth callback returns to bare /onboarding — persist the
  // deep link so it survives the round-trip.
  createEffect(() => {
    const next = sanitizeNext(searchParams.next);
    if (next) sessionStorage.setItem(FLOW_NEXT_STORAGE_KEY, next);
  });

  const afterTarget = () =>
    sanitizeNext(searchParams.next) ??
    sanitizeNext(sessionStorage.getItem(FLOW_NEXT_STORAGE_KEY)) ??
    AFTER_SETUP_ROUTE;

  /**
   * Mark the flow complete and verify it stuck: NewOnboardingRedirect keys
   * off tutorialComplete, so navigating before the cache reflects the PATCH
   * would bounce straight back here.
   */
  const completeFlow = async (): Promise<boolean> => {
    const [onboardingResult] = await Promise.allSettled([
      completeOnboarding.mutateAsync({ skipped: false }),
      completeTutorial.mutateAsync(),
    ]);
    // Exiting with the row still active would leave staged candidates
    // undiscarded and the flow resumable after the user thinks it's done.
    if (onboardingResult.status === 'rejected') {
      toast.failure("Couldn't finish setup — please try again");
      return false;
    }
    await queryClient
      .refetchQueries({ queryKey: authKeys.userInfo.queryKey })
      .catch(() => {});
    // Read the cache, not the query observer: observer stores flush on a
    // scheduled task, so right after the await they still hold the
    // pre-PATCH value and the guard would fail on a fresh success.
    const userInfo = queryClient.getQueryData<UserInfoData>(
      authKeys.userInfo.queryKey
    );
    if (userInfo?.tutorialComplete !== true) {
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
   * Hand the page to Stripe WITHOUT completing the flow: the onboarding
   * redirect plus the persisted step bring both checkout legs (success and
   * cancel) back to the plan step, which finishes only once payment is
   * confirmed. On failure the user stays on the plan step and can retry or
   * pick free.
   */
  const startPremiumCheckout = async (tier: PaidPlanTier) => {
    if (finishing()) return;
    setFinishing(true);
    try {
      const { checkoutUrl } = await createOnboardingCheckoutSession(tier);
      // Deliberately leave `finishing` set: the page is navigating away,
      // and re-enabling the buttons mid-unload invites a double checkout.
      window.location.href = checkoutUrl;
    } catch {
      toast.failure("Couldn't start checkout — please try again");
      setFinishing(false);
    }
  };

  /** Finish after checkout confirmed payment (or an existing license). */
  const finishPremium = async () => {
    if (finishing()) return;
    setFinishing(true);
    try {
      if (await completeFlow()) {
        trackCompleted('premium', false);
        navigate(afterTarget(), { replace: true });
      }
    } finally {
      setFinishing(false);
    }
  };

  return {
    finishing,
    finishFree,
    startPremiumCheckout,
    finishPremium,
    afterTarget,
  };
}
