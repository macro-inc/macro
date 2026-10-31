import { InviteOfferPanel } from '@app/features/gtm-invite/InviteOfferPanel';
import { useNavigate, useSearchParams } from '@solidjs/router';
import type { JSX } from 'solid-js';
import { onMount } from 'solid-js';
import { OnboardingProvider } from './context/onboarding-context';
import { parseCheckoutReturn } from './core/checkout';
import { parseOnboardingStepParam } from './core/steps';
import { createAppOnboardingContext } from './create-app-onboarding-context';
import { OnboardingFlowView } from './views/onboarding-flow-view';
import { SignupJourneyView } from './views/signup-journey-view';

/** The signed-in onboarding flow, wired to the app's services and router. */
export function Onboarding() {
  const context = createAppOnboardingContext();
  const navigate = useNavigate();
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
      />
    </OnboardingProvider>
  );
}

/** The signed-out opening slides, hosted by the sign-up page. */
export function OnboardingSignup(props: {
  onGoogle: () => Promise<void>;
  onBackFromEmail: () => void;
  onSignIn: () => void;
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
