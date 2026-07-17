import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { toast } from '@core/component/Toast/Toast';
import { useUserInfoQuery } from '@queries/auth/user-info';
import { useSearchParams } from '@solidjs/router';
import { createSignal, onCleanup, onMount } from 'solid-js';

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
  const subscriptionSuccess = searchParams.subscriptionSuccess;
  const [refreshPending, setRefreshPending] = createSignal(
    subscriptionSuccess === 'true'
  );
  let cancelled = false;

  onCleanup(() => {
    cancelled = true;
  });

  onMount(() => {
    if (subscriptionSuccess === 'true') {
      toast.success('Your plan has been activated!');
      analytics.track('subscription_success', { type: searchParams.type });

      void (async () => {
        try {
          for (
            let attempt = 0;
            attempt < CHECKOUT_REFRESH_ATTEMPTS;
            attempt++
          ) {
            const result = await userInfoQuery.refetch();
            const licenseStatus = result.data?.licenseStatus;
            if (
              cancelled ||
              licenseStatus === 'active' ||
              licenseStatus === 'trialing'
            ) {
              break;
            }

            if (attempt < CHECKOUT_REFRESH_ATTEMPTS - 1) {
              await new Promise((resolve) =>
                setTimeout(resolve, CHECKOUT_REFRESH_INTERVAL_MS)
              );
            }
          }
        } catch (error) {
          console.error('Failed to refresh user info after checkout', error);
        } finally {
          if (!cancelled) setRefreshPending(false);
        }
      })();
    }

    if (searchParams.subscriptionCancel === 'true') {
      analytics.track('subscription_cancel', { tier: searchParams.tier });
    }
  });

  return refreshPending;
}
