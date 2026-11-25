import { Login, NativeWelcome } from '@app/features/auth/auth';
import { makeEmailAuthComponents } from '@app/features/auth/EmailAuth';
import { Onboarding } from '@app/features/onboarding/onboarding';
import {
  BookingReceiptPage,
  PublicBookingPage,
} from '@app/features/scheduling/public-booking';
import { useRouteParams } from '@app/lib/split-router';
import { publishLoginSuccess } from '@core/auth/login-events';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { lazy } from '@core/util/lazy';
import { Navigate, useNavigate } from '@solidjs/router';
import { Button } from '@ui';
import { onCleanup, onMount } from 'solid-js';
import {
  bookingReceiptRoute,
  EMAIL_SIGNUP_CALLBACK_PATH,
  formRespondRoute,
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

/** The native apps sign up in the system browser, from their first screen. */
export function SignupPage() {
  return isNativeMobilePlatform() ? <NativeWelcome /> : <Login signupMode />;
}

/** The retired phone email capture forwards to signup, keeping attribution. */
export function MobileEmailSignupRedirect() {
  const navigate = useNavigate();
  onMount(() => {
    navigate(`/signup${window.location.search}`, { replace: true });
  });
  return null;
}

export function WelcomePage() {
  return isNativeMobilePlatform() ? <NativeWelcome /> : <Login />;
}

/** The native apps onboard in the browser sign-up that made the account. */
export function OnboardingPage() {
  return isNativeMobilePlatform() ? <Navigate href="/" /> : <Onboarding />;
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
          variant="secondary"
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

/** GitHub's connect step; its code loads only when someone connects GitHub. */
const GithubConnectPage = lazy(async () => ({
  default: (
    await import('@app/features/settings/connections/github-connect-page')
  ).GithubConnectPage,
}));

export function GithubConnectRoutePage() {
  return <GithubConnectPage />;
}

export function TaskSlugPage() {
  const params = useRouteParams(taskSlugRoute);
  return <TaskRoute taskSlug={params.taskSlug} />;
}

export function PublicBookingRoutePage() {
  const params = useRouteParams(publicBookingRoute);
  return <PublicBookingPage profile={params.profile} slug={params.slug} />;
}

/** Forms code loads only when someone opens a respond link. */
const FormRespondPage = lazy(async () => ({
  default: (await import('@app/features/block-form/form-respond-page'))
    .FormRespondPage,
}));

export function FormRespondRoutePage() {
  const params = useRouteParams(formRespondRoute);
  return <FormRespondPage formId={params.formId} />;
}

export function BookingReceiptRoutePage() {
  const params = useRouteParams(bookingReceiptRoute);
  return <BookingReceiptPage id={params.id} />;
}
