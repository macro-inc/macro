import { initAndStartEmailSync } from '@core/email-link';
import { isMobile } from '@core/mobile/isMobile';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { lazyNamed } from '@core/util/lazyNamed';
import { useUserInfoQuery } from '@queries/auth/user-info';
import { createEffect, createSignal, Show, Suspense } from 'solid-js';

// Only first-time mobile web users see it, and only once it opens.
const InteractiveOnboardingModal = lazyNamed(
  () => import('@app/features/tutorial/InteractiveOnboardingModal'),
  'InteractiveOnboardingModal'
);

export function InitialInteractiveOnboardingModal() {
  const userInfoQuery = useUserInfoQuery();
  const [open, setOpen] = createSignal(true);
  const [onboardingStarted, setOnboardingStarted] = createSignal(false);
  // Mounting waits for the first open so the modal's chunk stays off startup;
  // it stays mounted afterwards so closing can animate.
  const [hasOpened, setHasOpened] = createSignal(false);

  const modalOpen = () =>
    open() &&
    // Desktop first-run users go through /onboarding instead (Layout redirect).
    isMobile() &&
    !isNativeMobilePlatform() &&
    userInfoQuery.data?.authenticated === true &&
    (userInfoQuery.data.tutorialComplete === false || onboardingStarted());

  createEffect(() => {
    if (modalOpen()) {
      setOnboardingStarted(true);
      setHasOpened(true);
    }
  });

  // First-time users (tutorial not yet completed) reach the app without passing
  // through a login route that inits the email link — e.g. marketing SSO returns to
  // /app, not /login — so kick off email sync once here. Idempotent on the backend;
  // AlreadyInitialized is ignored. Keyed by user id (not a bare flag) so a native
  // mobile logout→login of a different user in the same session still inits.
  let emailInitForUserId: string | undefined;
  createEffect(() => {
    const data = userInfoQuery.data;
    if (data?.authenticated !== true || data.tutorialComplete !== false) return;
    if (emailInitForUserId === data.id) return;
    emailInitForUserId = data.id;

    void initAndStartEmailSync().match(
      () => {},
      (err) => {
        if (err.tag !== 'AlreadyInitialized') {
          console.error('Failed to init email link for new user', err);
        }
      }
    );
  });

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setOnboardingStarted(false);
    }
  };

  return (
    <Show when={hasOpened()}>
      <Suspense>
        <InteractiveOnboardingModal
          open={modalOpen()}
          isFirstTimeOnboarding
          onOpenChange={handleOpenChange}
        />
      </Suspense>
    </Show>
  );
}
