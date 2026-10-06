import { Login } from '@app/features/auth/auth';
import { makeEmailAuthComponents } from '@app/features/auth/EmailAuth';
import { MobileAuthWelcome } from '@app/features/mobile-onboarding/MobileAuthWelcome';
import { MobileOnboarding } from '@app/features/mobile-onboarding/MobileOnboarding';
import { Onboarding } from '@app/features/onboarding/onboarding';
import {
  BookingReceiptPage,
  PublicBookingPage,
} from '@app/features/scheduling/public-booking';
import { useRouteParams } from '@app/lib/split-router';
import { publishLoginSuccess } from '@core/auth/login-events';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { Button } from '@ui';
import { onCleanup, onMount } from 'solid-js';
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

export function OnboardingPage() {
  return isNativeMobilePlatform() ? <MobileOnboarding /> : <Onboarding />;
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
