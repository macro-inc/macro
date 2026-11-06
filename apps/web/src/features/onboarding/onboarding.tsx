import { InviteOfferPanel } from '@app/features/gtm-invite/InviteOfferPanel';
import { InlineBooking } from '@app/features/scheduling/inline-booking';
import { openExternalUrl } from '@core/util/url';
import { useUserInfoQuery } from '@queries/auth/user-info';
import { useNavigate, useSearchParams } from '@solidjs/router';
import { Button } from '@ui';
import type { JSX } from 'solid-js';
import { createEffect, onMount } from 'solid-js';
import { OnboardingProvider } from './context/onboarding-context';
import { parseCheckoutReturn } from './core/checkout';
import { parseOnboardingStepParam } from './core/steps';
import { createAppOnboardingContext } from './create-app-onboarding-context';
import { OnboardingFlowView } from './views/onboarding-flow-view';
import { SignupJourneyView } from './views/signup-journey-view';

/** Macro's demo booking page (`/book/<profile>/<event>`), also linked from the website. */
const DEMO_BOOKING = {
  profile: '6de4003c-15e4-549f-b5a9-0e930bbf56e4',
  event: 'macro-demo',
};
const DEMO_BOOKING_URL = `https://macro.com/app/book/${DEMO_BOOKING.profile}/${DEMO_BOOKING.event}`;

/** The signed-in onboarding flow, wired to the app's services and router. */
export function Onboarding() {
  const context = createAppOnboardingContext();
  const navigate = useNavigate();
  const userInfoQuery = useUserInfoQuery();
  // Agents never onboard, even when they open the link directly.
  createEffect(() => {
    if (userInfoQuery.data?.isAgent) navigate('/', { replace: true });
  });
  const [params, setParams] = useSearchParams();
  // Captured once. The link is removed below, and later progress must win
  // on reload instead of the original step.
  const requestedStep = parseOnboardingStepParam(params.step);
  onMount(() => {
    if (params.step === undefined) return;
    setParams({ step: undefined }, { replace: true });
  });
  return (
    <OnboardingProvider value={context}>
      <OnboardingFlowView
        next={typeof params.next === 'string' ? params.next : undefined}
        step={requestedStep}
        checkoutReturn={parseCheckoutReturn(params)}
        onNavigate={(target) => navigate(target, { replace: true })}
        onRedirect={(url) => {
          window.location.href = url;
        }}
        onSignedOut={() => navigate('/login', { replace: true })}
        renderInviteOffer={(offer, actions) => (
          <InviteOfferPanel
            offer={offer}
            finishing={actions.finishing()}
            onStartCheckout={actions.onClaim}
            onContinueFree={actions.onContinueFree}
          />
        )}
        renderDemoBooking={(actions) => (
          <InlineBooking
            profile={DEMO_BOOKING.profile}
            event={DEMO_BOOKING.event}
            guestEmail={actions.guestEmail}
            onBooked={(booking) => actions.onBooked(booking.startsAt)}
            unavailable={
              <div class="flex flex-col items-center gap-4 p-8 text-center text-sm text-ink-muted">
                <p>Pick a time on our booking page.</p>
                <Button
                  variant="secondary"
                  onClick={() => openExternalUrl(DEMO_BOOKING_URL)}
                >
                  Open booking page
                </Button>
              </div>
            }
          />
        )}
      />
    </OnboardingProvider>
  );
}

/** The signed-out opening slides, hosted by the sign-up page. */
export function OnboardingSignup(props: {
  onGoogle: () => Promise<void>;
  onBackFromEmail: () => void;
  onSignIn: () => void;
  onAgentSignup: () => void;
  emailForm?: JSX.Element;
  showingEmail: boolean;
}) {
  return (
    <OnboardingProvider value={createAppOnboardingContext()}>
      <SignupJourneyView {...props} />
    </OnboardingProvider>
  );
}

export { clearSignupDraft } from './primitives/flow-storage';
export { OnboardingPendingView as OnboardingPending } from './views/onboarding-pending-view';
