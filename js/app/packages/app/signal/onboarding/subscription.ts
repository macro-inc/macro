import { toast } from '@core/component/Toast/Toast';
import { licenseChannel } from '@core/util/licenseUpdateBroadcastChannel';
import { isErr } from '@core/util/maybeResult';
import { logger } from '@observability';
import { updateUserInfo, useLicenseStatus } from '@service-gql/client';
import { stripeServiceClient } from '@service-stripe/client';
import { raceTimeout, until } from '@solid-primitives/promise';
import { useSearchParams } from '@solidjs/router';
import { type Accessor, createSignal } from 'solid-js';

type SubscriptionTimeoutError = 'subscription_timeout';
const SUBSCRIPTION_SUCCESS_TIMEOUT = 60_000;

/**
 * Waits for the license to be updated.
 *
 * @returns A promise that resolves when the license is updated.
 */
async function waitForLicenseUpdate(): Promise<void | SubscriptionTimeoutError> {
  try {
    await raceTimeout(
      new Promise((resolve) => {
        licenseChannel.subscribe(() => {
          resolve(undefined);
        });
      }),
      SUBSCRIPTION_SUCCESS_TIMEOUT,
      true
    );
  } catch (error) {
    logger.error(
      '[email] failed to authenticate with google gmail after sign up',
      { error }
    );
    return 'subscription_timeout';
  }
}

/**
 * Waits for the subscription to be successful.
 *
 * @returns A promise that resolves when the subscription is successful.
 */
async function waitForSubscriptionSuccess(): Promise<void | SubscriptionTimeoutError> {
  const [searchParams] = useSearchParams();
  try {
    await raceTimeout(
      until(() => searchParams.subscriptionSuccess === 'true'),
      SUBSCRIPTION_SUCCESS_TIMEOUT,
      true
    );
  } catch (error) {
    logger.error(
      '[email] failed to authenticate with google gmail after sign up',
      { error }
    );
    return 'subscription_timeout';
  }
}

/**
 * Redirects to the checkout session.
 *
 * @returns A promise that resolves when the checkout session is created.
 */
async function redirectToCheckout(): Promise<
  void | 'failed_to_create_checkout_session'
> {
  let url: string;
  try {
    url = await stripeServiceClient.createCheckoutSession('New subscription');
  } catch (error) {
    logger.error(
      '[email] failed to authenticate with google gmail after sign up',
      { error }
    );
    return 'failed_to_create_checkout_session';
  }

  if (!url) {
    return 'failed_to_create_checkout_session';
  }

  window.location.href = url;
}

export type CheckoutState =
  | { type: 'idle' }
  | { type: 'loading' }
  | { type: 'failed' }
  | { type: 'finished' };

/**
 * Hook that handles the checkout process.
 *
 * @returns A tuple containing the checkout state and a function to handle the checkout process.
 */
export function useCheckout(): [Accessor<CheckoutState>, () => Promise<void>] {
  const previousLicenseStatus = useLicenseStatus();

  const DEFAULT_CHECKOUT_STATE: CheckoutState = previousLicenseStatus()
    ? { type: 'finished' }
    : { type: 'idle' };

  const [checkoutState, setCheckoutState] = createSignal<CheckoutState>(
    DEFAULT_CHECKOUT_STATE
  );

  const checkout = async () => {
    if (checkoutState().type !== 'idle') return;
    setCheckoutState({ type: 'loading' });
    const res = await redirectToCheckout();

    if (res === 'failed_to_create_checkout_session') {
      toast.failure('Failed to create checkout session');
      setCheckoutState({ type: 'failed' });
      return;
    }

    const result = await Promise.race([
      waitForLicenseUpdate(),
      waitForSubscriptionSuccess(),
    ]);

    if (result === 'subscription_timeout') {
      toast.failure('Subscription timed out. Please email contact@macro.com');
      setCheckoutState({ type: 'failed' });
      return;
    }

    const userInfo = await updateUserInfo();

    if (!userInfo || isErr(userInfo) || !userInfo[1]) {
      toast.failure(
        'Failed to create subscription. Please email contact@macro.com'
      );
      setCheckoutState({ type: 'failed' });
      return;
    }

    setCheckoutState({ type: 'finished' });
  };

  return [checkoutState, checkout];
}
