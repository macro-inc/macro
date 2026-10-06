import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { toast } from '@core/component/Toast/Toast';
import { useUserInfoQuery } from '@queries/auth/user-info';
import { useSearchParams } from '@solidjs/router';
import { createEffect, createSignal, on, onCleanup } from 'solid-js';

const CHECKOUT_REFRESH_ATTEMPTS = 10;
const CHECKOUT_REFRESH_INTERVAL_MS = 1_000;

/**
 * Handles Stripe checkout return parameters and refreshes user information
 * until the asynchronously updated license becomes available.
 */
export function useCheckoutCompletionListener() {
  const analytics = useAnalytics();
  const [searchParams] = useSearchParams();
  const userInfoQuery = useUserInfoQuery();
  const [refreshComplete, setRefreshComplete] = createSignal(false);
  let handledSuccess = false;
  let handledCancel = false;
  let cancelled = false;

  onCleanup(() => {
    cancelled = true;
  });

  async function refreshLicense() {
    try {
      for (let attempt = 0; attempt < CHECKOUT_REFRESH_ATTEMPTS; attempt++) {
        if (cancelled) break;
        const result = await userInfoQuery.refetch();
        const licenseStatus = result.data?.licenseStatus;
        if (
          cancelled ||
          licenseStatus === 'active' ||
          licenseStatus === 'trialing'
        )
          break;
        if (attempt < CHECKOUT_REFRESH_ATTEMPTS - 1) {
          await new Promise((resolve) =>
            setTimeout(resolve, CHECKOUT_REFRESH_INTERVAL_MS)
          );
        }
      }
    } catch (error) {
      console.error('Failed to refresh user info after checkout', error);
    } finally {
      if (!cancelled) setRefreshComplete(true);
    }
  }

  createEffect(
    on(
      () => [searchParams.subscriptionSuccess, searchParams.subscriptionCancel],
      ([success, cancel]) => {
        if (success === 'true' && !handledSuccess) {
          handledSuccess = true;
          toast.success('Your plan has been activated!');
          analytics.track('subscription_success', { type: searchParams.type });
          void refreshLicense();
        }
        if (cancel === 'true' && !handledCancel) {
          handledCancel = true;
          analytics.track('subscription_cancel', { tier: searchParams.tier });
        }
      }
    )
  );

  // Gate navigation immediately when a late native link changes the query,
  // before the effect starts its refresh, and release it when polling settles.
  return () =>
    searchParams.subscriptionSuccess === 'true' && !refreshComplete();
}
