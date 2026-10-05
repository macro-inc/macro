import { InviteOfferPanel } from '@app/features/gtm-invite/InviteOfferPanel';
import { useImportQuery } from '@queries/import';
import { useNavigate, useSearchParams } from '@solidjs/router';
import type { JSX } from 'solid-js';
import { OnboardingProvider } from './context/onboarding-context';
import { parseCheckoutReturn } from './core/checkout';
import { createAppOnboardingContext } from './create-app-onboarding-context';
import { OnboardingFlowView } from './views/onboarding-flow-view';
import { SignupJourneyView } from './views/signup-journey-view';

/** The signed-in onboarding flow, wired to the app's services and router. */
export function Onboarding() {
  const context = createAppOnboardingContext();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // Polling the import state keeps gather runs starting while the user is in
  // the flow; the steps themselves never read it.
  useImportQuery({
    enabled: () => {
      const viewer = context.viewer();
      return viewer.t === 'signed-in' && !viewer.viewer.tutorialComplete;
    },
  });
  return (
    <OnboardingProvider value={context}>
      <OnboardingFlowView
        next={typeof params.next === 'string' ? params.next : undefined}
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
      />
    </OnboardingProvider>
  );
}

/** The signed-out opening slides, hosted by the sign-up page. */
export function OnboardingSignup(props: {
  onGoogle: () => Promise<void>;
  onBackFromEmail: () => void;
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
