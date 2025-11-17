import { DEFAULT_ROUTE } from '@app/constants/defaultRoute';
import { withAnalytics } from '@coparse/analytics';
import { useNavigate } from '@solidjs/router';
import { createEffect, createSignal, on } from 'solid-js';
import { match } from 'ts-pattern';
import {
  type EmailAuthenticationState,
  useEmailInitializeAndPoll,
  useSignUpAndConnectEmail,
} from './email-link';
import { type CheckoutState, useCheckout } from './subscription';

type OnboardingState =
  | { step: 'needs_auth'; authenticating: boolean }
  | { step: 'needs_subscription'; subscribing: boolean }
  | { step: 'complete' };

function deriveState(
  authState: EmailAuthenticationState,
  checkoutState: CheckoutState
): OnboardingState {
  const authenticated = authState.type === 'authenticated';
  const authenticating = authState.type === 'authenticating';

  if (!authenticated) {
    return { step: 'needs_auth', authenticating };
  }

  const subscribed = checkoutState.type === 'finished';
  const subscribing = checkoutState.type === 'loading';

  if (!subscribed) {
    return { step: 'needs_subscription', subscribing: subscribing };
  }
  return { step: 'complete' };
}

export function useOnboarding() {
  const { track, TrackingEvents } = withAnalytics();
  const [progress, setProgress] = createSignal(0);
  const [authenticatedState, signUpAndConnectEmail] =
    useSignUpAndConnectEmail();
  const [checkoutState, checkout] = useCheckout();
  const [__, pollEmailInitialize] = useEmailInitializeAndPoll();
  const navigate = useNavigate();

  const onboardingState = () =>
    deriveState(authenticatedState(), checkoutState());

  createEffect(
    on(onboardingState, (state) => {
      match(state)
        .with({ step: 'needs_auth', authenticating: false }, () => {
          setProgress(0);
        })
        .with({ step: 'needs_auth', authenticating: true }, () => {
          setProgress(25);
        })
        .with({ step: 'needs_subscription', subscribing: false }, () => {
          setProgress(50);
        })
        .with({ step: 'needs_subscription', subscribing: true }, () => {
          setProgress(75);
        })
        .with({ step: 'complete' }, () => {
          setProgress(100);
          if (localStorage.getItem('new_user_onboarding')) {
            track(TrackingEvents.ONBOARDING.COMPLETE);
            localStorage.removeItem('new_user_onboarding');
          }
          pollEmailInitialize();
          return navigate(DEFAULT_ROUTE);
        })
        .exhaustive();
    })
  );

  return {
    progress,
    onboardingState,
    checkout,
    authenticatedState,
    checkoutState,
    signUpAndConnectEmail,
  };
}
