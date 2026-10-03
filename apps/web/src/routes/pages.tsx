import { makeEmailAuthComponents } from '@app/features/auth/EmailAuth';
import { Login } from '@app/features/auth/Login';
import { MobileAuthWelcome } from '@app/features/auth/mobile-onboarding/MobileAuthWelcome';
import { MobileOnboarding } from '@app/features/auth/mobile-onboarding/MobileOnboarding';
import {
  BookingReceiptPage,
  PublicBookingPage,
} from '@app/features/scheduling/public-booking';
import { OnboardingFlow } from '@app/features/setup/flow/OnboardingFlow';
import { useOnboardingV4Flag } from '@app/features/setup/flow/useOnboardingV4Flag';
import { useRouteParams } from '@app/lib/split-router';
import { publishLoginSuccess } from '@core/auth/login-events';
import { LoadingBlock } from '@core/component/LoadingBlock';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { Navigate, useLocation } from '@solidjs/router';
import { Button } from '@ui';
import { onCleanup, onMount, Show } from 'solid-js';
import {
  bookingReceiptRoute,
  EMAIL_SIGNUP_CALLBACK_PATH,
  INBOX_LINK_CALLBACK_PATH,
  publicBookingRoute,
  taskSlugRoute,
} from './routes';
import { TaskRoute } from './TaskRoute';

export const { EmailCallback, EmailLinkCallback } = makeEmailAuthComponents({
  callbackPath: EMAIL_SIGNUP_CALLBACK_PATH,
  linkCallbackPath: INBOX_LINK_CALLBACK_PATH,
  successPath: '/',
});

export function LoginPage() {
  return <Login />;
}

export function SignupPage() {
  return <Login signupMode />;
}

export function WelcomePage() {
  return isNativeMobilePlatform() ? <MobileAuthWelcome /> : <Login />;
}

/** The retired /setup path forwards to the onboarding flow, query intact. */
function SetupRedirect() {
  const location = useLocation();
  return <Navigate href={`/onboarding${location.search}`} />;
}

/**
 * The old split-screen /setup surface is retired; the onboarding flow lives at
 * /onboarding now. Flag off, /setup must go home — forwarding would land
 * flag-off web users on /login and native users on MobileOnboarding.
 */
export function SetupPage() {
  const onboardingV4 = useOnboardingV4Flag();

  return (
    <Show when={!onboardingV4().loading} fallback={<LoadingBlock />}>
      <Show when={onboardingV4().enabled} fallback={<Navigate href="/" />}>
        <SetupRedirect />
      </Show>
    </Show>
  );
}

/**
 * Web/desktop gate for /onboarding. Waits for PostHog to report flags before
 * bouncing: with the flag on but not yet loaded, a direct visit (or a reload
 * mid-flow) would otherwise get kicked to /login and lose its ?next.
 */
function OnboardingRoute() {
  const onboardingV4 = useOnboardingV4Flag();

  return (
    <Show when={!onboardingV4().loading} fallback={<LoadingBlock />}>
      <Show when={onboardingV4().enabled} fallback={<Navigate href="/login" />}>
        <OnboardingFlow />
      </Show>
    </Show>
  );
}

/**
 * Flag-gated here, not just at the redirect: with the flag off a direct visit
 * must not touch the onboarding backend (reading it creates the flow's row
 * and starts gathers).
 */
export function OnboardingPage() {
  return isNativeMobilePlatform() ? <MobileOnboarding /> : <OnboardingRoute />;
}

export function LoginPopupSuccess() {
  onMount(() => {
    publishLoginSuccess();
    window.close();
  });

  onCleanup(() => {
    window.close();
  });

  return (
    <div class="h-full overflow-y-hidden">
      <div class="relative flex flex-row items-center pt-4 h-full">
        <Button
          variant="outline"
          onClick={() => {
            publishLoginSuccess();
            window.close();
          }}
        >
          Close
        </Button>
      </div>
    </div>
  );
}

export function TaskSlugPage() {
  const params = useRouteParams(taskSlugRoute);
  return <TaskRoute taskSlug={params.taskSlug} />;
}

export function PublicBookingRoutePage() {
  const params = useRouteParams(publicBookingRoute);
  return <PublicBookingPage profile={params.profile} slug={params.slug} />;
}

export function BookingReceiptRoutePage() {
  const params = useRouteParams(bookingReceiptRoute);
  return <BookingReceiptPage id={params.id} />;
}
